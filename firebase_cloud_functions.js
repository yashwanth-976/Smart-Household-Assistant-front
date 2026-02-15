const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

admin.initializeApp();

// Access environment variables set via `firebase functions:config:set`
// config: supabase.url, supabase.key
const supabaseUrl = functions.config().supabase.url;
const supabaseKey = functions.config().supabase.key;
const supabase = createClient(supabaseUrl, supabaseKey);

exports.dailyExpiryCheck = functions.pubsub.schedule('every day 09:00')
    .timeZone('Asia/Kolkata') // IST
    .onRun(async (context) => {

        console.log('Starting Daily Expiry Check...');
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const start = new Date(today);
        start.setDate(today.getDate() + 1); // Tomorrow
        const startStr = start.toISOString().split('T')[0];

        const end = new Date(today);
        end.setDate(today.getDate() + 7); // 7 Days from now
        const endStr = end.toISOString().split('T')[0];

        try {
            // 1. Fetch Products expiring in next 7 days (Inclusive)
            const { data: products, error } = await supabase
                .from('products')
                .select('user_id, name, expiry_date')
                .gte('expiry_date', today.toISOString().split('T')[0]) // >= Today (Include 0 days)
                .lte('expiry_date', endStr);  // <= 7 Days

            if (error) throw new Error(`Supabase Error: ${error.message}`);
            if (!products || products.length === 0) {
                console.log('No expiring products found.');
                return null;
            }

            // 2. Group by User & Filter for Specific Days (0, 2, 5)
            const userProducts = {};
            products.forEach(p => {
                // Calc days difference
                const exp = new Date(p.expiry_date);
                const diffTime = exp - today;
                const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                // STRICT FILTER: Only notify if days match 0 or 1 (Today or Tomorrow)
                if ([0, 1].includes(days)) {
                    if (!userProducts[p.user_id]) userProducts[p.user_id] = [];
                    userProducts[p.user_id].push({ name: p.name, days: days });
                }
            });

            // 3. Process Notifications
            const userIds = Object.keys(userProducts);
            const notifications = [];

            if (userIds.length === 0) {
                console.log('No products match notification criteria (0, 2, 5 days).');
                return null;
            }

            // Fetch Tokens
            const { data: tokensData, error: tokenError } = await supabase
                .from('fcm_tokens')
                .select('user_id, token')
                .in('user_id', userIds);

            if (tokenError) throw new Error(`Token Fetch Error: ${tokenError.message}`);

            const userTokens = {};
            tokensData.forEach(t => {
                if (!userTokens[t.user_id]) userTokens[t.user_id] = [];
                userTokens[t.user_id].push(t.token);
            });

            // 4. Construct Messages
            userIds.forEach(uid => {
                const items = userProducts[uid];
                const tokens = userTokens[uid];
                if (!tokens || tokens.length === 0) return;

                // Sort items by urgency (days asc)
                items.sort((a, b) => a.days - b.days);

                // Format: "Milk expires in 2 days"
                const summaryParts = items.slice(0, 3).map(i => {
                    let timePart;
                    if (i.days === 0) timePart = "expires today";
                    else if (i.days === 1) timePart = "expires tomorrow";
                    else timePart = `expires in ${i.days} days`; // Fallback

                    return `${i.name} ${timePart}`;
                });

                const moreCount = items.length - 3;
                const bodyText = summaryParts.join('\n') + (moreCount > 0 ? `\n+${moreCount} more items.` : '');

                const message = {
                    notification: {
                        title: 'Smart Household Assistant',
                        body: bodyText
                    },
                    // Android Notification Options for "System-like" feel
                    android: {
                        priority: 'high',
                        notification: {
                            icon: 'stock_ticker_update', // default system icon or app icon
                            color: '#4F46E5', // Primary brand color
                            defaultSound: true,
                            defaultVibrateTimings: true
                        }
                    },
                    tokens: tokens
                };

                notifications.push(admin.messaging().sendEachForMulticast(message));
            });

            if (notifications.length > 0) {
                await Promise.all(notifications);
                console.log(`Sent to ${notifications.length} users.`);
            }

        } catch (err) {
            console.error('Check Failed:', err);
        }

        return null;
    });
