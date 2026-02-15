document.addEventListener('DOMContentLoaded', async () => {
  // --- 0. Protocol Check ---
  if (window.location.protocol === 'file:') {
    alert('CRITICAL: App is running via file:// protocol.\n\nPlease use a local server (e.g., Live Server in VS Code) for features to work.');
    console.error('App running via file:// protocol. Supabase will likely fail.');
  }

  // --- 1. DOM Elements (Initialize these FIRST) ---
  const form = document.getElementById('add-product-form');
  const listContainer = document.getElementById('inventory-list');
  const alertBanner = document.getElementById('alert-banner');
  const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
  const exitBtn = document.getElementById('exit-app-btn');

  const userFabBtn = document.getElementById('user-fab-btn');
  const fabMenu = document.getElementById('fab-menu');

  const analysisModal = document.getElementById('analysis-modal');
  const aiModal = document.getElementById('ai-modal');
  const btnAnalysis = document.getElementById('menu-viz');
  const btnAI = document.getElementById('menu-ai');
  const closeAnalysis = document.getElementById('close-analysis');
  const closeAI = document.getElementById('close-ai');

  // Chart
  let myChart = null;



  // --- 3. Event Listeners (Attach BEFORE Auth Check) ---

  if (exitBtn) {
    exitBtn.addEventListener('click', handleLogout);
  }

  if (userFabBtn) {
    userFabBtn.addEventListener('click', toggleUserMenu);
  }

  // Close menu when clicking outside
  window.addEventListener('click', (e) => {
    if (userFabBtn && fabMenu && !userFabBtn.contains(e.target) && !fabMenu.contains(e.target)) {
      if (!fabMenu.classList.contains('hidden')) {
        fabMenu.classList.add('hidden');
      }
    }
  });

  setupModal(btnAnalysis, analysisModal, closeAnalysis, fabMenu, renderAnalysis);
  setupModal(btnAI, aiModal, closeAI, fabMenu);

  window.addEventListener('click', (e) => {
    if (e.target === analysisModal) analysisModal.classList.add('hidden');
    if (e.target === aiModal) aiModal.classList.add('hidden');
  });

  // --- Swipe Gestures ---
  setupSwipeGestures();

  // --- Speech Recognition ---
  const micBtn = document.getElementById('mic-btn');
  const productNameInput = document.getElementById('product-name');

  if (micBtn && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';

    micBtn.addEventListener('click', () => {
      micBtn.style.color = 'var(--danger)';
      recognition.start();
    });

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const capitalized = transcript.charAt(0).toUpperCase() + transcript.slice(1);
      productNameInput.value = capitalized;
      micBtn.style.color = 'var(--primary)';
    };

    recognition.onerror = () => {
      micBtn.style.color = 'var(--primary)';
      alert('Voice recognition failed.');
    };
    recognition.onend = () => { micBtn.style.color = 'var(--primary)'; };
  } else if (micBtn) {
    micBtn.style.display = 'none';
  }

  // --- Functions ---
  async function handleLogout() {
    // If Supabase is missing (file://), just redirect
    const supabase = window.sb;
    if (!supabase) {
      window.location.href = 'auth.html';
      return;
    }

    if (confirm('Are you sure you want to logout?')) {
      const { error } = await supabase.auth.signOut();
      if (!error) window.location.href = 'auth.html';
    }
  }

  // --- 4. Supabase Logic (Can Fail) ---
  const supabase = window.sb;

  // --- State Management ---
  let inventory = [];
  let editingId = null;
  const expandedItems = new Set();
  let currentUser = null;

  if (!supabase) {
    console.warn('Supabase not initialized (likely file://). UI functionality will be limited.');
    // Do NOT return here, let UI work as much as possible
  } else {
    // Check Session
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      currentUser = session.user;

      // Setup Form & List Listeners ONLY if auth is valid
      form.addEventListener('submit', handleFormSubmit);
      listContainer.addEventListener('click', handleInventoryClick);

      // Initial Load
      await fetchProducts();
    } else {
      // If no session, redirect to auth page
      window.location.href = 'auth.html';
      return; // Stop further execution
    }
  }





  async function fetchProducts() {
    // Safety check if currentUser is not set (e.g. Supabase failed)
    if (!currentUser) return;

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('expiry_date', { ascending: true });

    if (error) {
      console.error('Error fetching products:', error);
      return;
    }

    // Process & Filter Expired
    const validInventory = [];
    const deletePromises = [];

    data.forEach(item => {
      const daysLeft = calculateDaysLeft(item.expiry_date);
      if (daysLeft < 0) {
        // Auto Delete Expired
        console.log(`Auto-deleting expired item: ${item.name}`);
        deletePromises.push(supabase.from('products').delete().eq('id', item.id));
      } else {
        validInventory.push({
          ...item,
          expiryDate: item.expiry_date,
          daysLeft: daysLeft // Cache it
        });
      }
    });

    if (deletePromises.length > 0) {
      Promise.all(deletePromises).then(() => console.log('Expired items cleaned up.'));
    }

    inventory = validInventory;
    renderProducts();
  }

  function setupModal(btn, modal, closeBtn, menu, openCallback) {
    if (btn) {
      btn.addEventListener('click', () => {
        modal.classList.remove('hidden');
        if (menu) menu.classList.add('hidden');
        if (openCallback) openCallback();
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    }
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    const nameVal = document.getElementById('product-name').value;
    const catVal = document.getElementById('category').value;
    const qtyVal = parseFloat(document.getElementById('quantity').value);
    const unitVal = document.getElementById('unit').value;
    const priceVal = parseFloat(document.getElementById('price').value) || 0;
    const expiryVal = document.getElementById('expiry-date').value;

    const payload = {
      name: nameVal,
      category: catVal,
      quantity: qtyVal,
      unit: unitVal,
      price: priceVal,
      expiry_date: expiryVal,
      user_id: currentUser.id
    };

    if (editingId) {
      const { error } = await supabase
        .from('products')
        .update(payload)
        .eq('id', editingId);

      if (error) alert('Error updating: ' + error.message);

      editingId = null;
      submitBtn.textContent = 'Add to Inventory';
    } else {
      const { error } = await supabase
        .from('products')
        .insert([payload]);

      if (error) alert('Error adding: ' + error.message);
    }

    submitBtn.disabled = false;
    if (!editingId) submitBtn.textContent = 'Add to Inventory';

    form.reset();
    await fetchProducts();
  }

  function handleInventoryClick(e) {
    const target = e.target;
    // Handle Undo Toast Click
    if (target.closest('.undo-action')) return;

    // Handle Buttons
    const actionBtn = target.closest('button');

    if (actionBtn) {
      const action = actionBtn.dataset.action;
      const id = actionBtn.dataset.id;

      if (action && id) {
        e.stopPropagation();
        if (action === 'increment') updateQuantity(id, 1);
        if (action === 'decrement') updateQuantity(id, -1);
        if (action === 'edit') populateEditForm(id);
        if (action === 'delete') deleteProduct(id);
      }
      return;
    }

    if (target.closest('.item-actions') || target.closest('.qty-controls')) return;

    const card = target.closest('.inventory-item');
    if (card) {
      const id = card.dataset.id;
      if (card.classList.contains('expanded')) {
        card.classList.remove('expanded');
        expandedItems.delete(id);
      } else {
        card.classList.add('expanded');
        expandedItems.add(id);
      }
    }
  }

  function renderProducts() {
    if (!listContainer) return;
    listContainer.innerHTML = '';

    inventory.sort((a, b) => a.daysLeft - b.daysLeft);

    if (inventory.length === 0) {
      listContainer.innerHTML = '<p class="text-center text-muted" style="margin-top: 2rem;">No items yet. Add one!</p>';
      if (alertBanner) alertBanner.classList.add('hidden');
      return;
    }

    let expiringSoonCount = 0; // items <= 5 days

    inventory.forEach(item => {
      const days = item.daysLeft;
      if (days <= 5) expiringSoonCount++;

      const statusClass = getStatusClass(days);
      const isExpanded = expandedItems.has(item.id) ? 'expanded' : '';

      let expiryLabel;
      // "Today" (0) and "Tomorrow" (1) labels
      if (days === 0) expiryLabel = 'Expires Today';
      else if (days === 1) expiryLabel = 'Expires Tomorrow';
      else expiryLabel = `${days} days left`;

      const itemEl = document.createElement('div');
      itemEl.className = `inventory-item ${statusClass} ${isExpanded}`;
      itemEl.dataset.id = item.id;

      // Swipe Handler
      addSwipeHandler(itemEl, item.id);

      itemEl.innerHTML = `
        <div class="item-header">
           <div class="item-name">${item.name}</div>
           <div class="item-brief-expiry">${expiryLabel}</div>
        </div>
        <div class="item-details-container">
           <div class="detail-row"><span>Category</span><span>${item.category}</span></div>
           <div class="detail-row"><span>Expiry Date</span><span>${item.expiryDate}</span></div>
           <div class="detail-row"><span>Price</span><span>₹${item.price.toFixed(2)}</span></div>
           <div class="item-actions">
              <div class="qty-controls">
                 <button class="qty-btn" type="button" data-action="decrement" data-id="${item.id}">-</button>
                 <span class="qty-val">${item.quantity} ${item.unit}</span>
                 <button class="qty-btn" type="button" data-action="increment" data-id="${item.id}">+</button>
              </div>
              <div class="action-icons">
                 <button class="icon-btn" type="button" data-action="edit" data-id="${item.id}" title="Edit">
                   <span class="material-icons-round">edit</span>
                 </button>
                 <button class="icon-btn delete" type="button" data-action="delete" data-id="${item.id}" title="Delete">
                   <span class="material-icons-round">delete</span>
                 </button>
              </div>
           </div>
        </div>
      `;
      listContainer.appendChild(itemEl);
    });

    if (alertBanner) {
      if (expiringSoonCount > 0) {
        alertBanner.innerHTML = `<span class="material-icons-round" style="margin-right: 0.5rem; font-size: 1.2rem;">warning</span>${expiringSoonCount} item(s) expiring soon`;
        alertBanner.classList.remove('hidden');
      } else {
        alertBanner.classList.add('hidden');
      }
    }
  }

  function toggleUserMenu(e) {
    if (e) e.stopPropagation();
    if (fabMenu) fabMenu.classList.toggle('hidden');
  }

  function populateEditForm(id) {
    const item = inventory.find(i => i.id === id);
    if (!item) return;

    document.getElementById('product-name').value = item.name;
    document.getElementById('category').value = item.category;
    document.getElementById('quantity').value = item.quantity;
    document.getElementById('unit').value = item.unit;
    document.getElementById('price').value = item.price;
    document.getElementById('expiry-date').value = item.expiryDate;

    editingId = id;
    submitBtn.textContent = 'Update Product';

    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.getElementById('product-name').focus();
  }

  async function updateQuantity(id, change) {
    const item = inventory.find(i => i.id === id);
    if (item) {
      let newQty = Number(item.quantity) + change;
      if (newQty <= 0) {
        if (confirm('Delete this item?')) {
          deleteProduct(id, true); // true = quiet/no double confirm
          return;
        } else {
          return;
        }
      }

      const { error } = await supabase
        .from('products')
        .update({ quantity: newQty })
        .eq('id', id);

      if (error) alert('Update failed: ' + error.message);
      else await fetchProducts();
    }
  }

  // Modified deleteProduct to accept confirm flag logic
  async function deleteProduct(id, skipConfirm = false) {
    if (!skipConfirm && !confirm('Are you sure you want to delete this item?')) return;

    const { error } = await supabase.from('products').delete().eq('id', id);

    if (error) {
      alert('Delete failed: ' + error.message);
    } else {
      if (editingId === id) {
        editingId = null;
        form.reset();
        submitBtn.textContent = 'Add to Inventory';
      }
      await fetchProducts();
    }
  }

  // --- Utility Functions ---

  function calculateDaysLeft(dateStr) {
    if (!dateStr) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Local midnight

    // Parse YYYY-MM-DD strictly as local time
    const parts = dateStr.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Months are 0-indexed
    const day = parseInt(parts[2], 10);

    const target = new Date(year, month, day);
    const diff = target - today;

    // Round to nearest day to handle DST or slight offsets
    return Math.round(diff / (1000 * 60 * 60 * 24));
  }

  function getStatusClass(days) {
    if (days <= 2) return 'expiry-red';
    if (days <= 5) return 'expiry-yellow';
    return 'expiry-green'; // Default for >= 6
  }

  // --- Swipe Gesture Logic ---

  function setupSwipeGestures() {
    // 1. Dashboard Swipe Right (General)
    let startX = 0;
    let startY = 0;

    document.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchend', e => {
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const diffX = endX - startX;
      const diffY = endY - startY;

      // Check horizontal swipe dominant
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 100) {

        // Swipe Right -> Go to Add Product (Top) OR Back from Viz
        if (diffX > 0) {
          const vizSection = document.getElementById('visualization-section');
          if (vizSection && !vizSection.classList.contains('hidden')) {
            vizSection.classList.add('hidden'); // Swipe Back
          } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            const nameInput = document.getElementById('product-name');
            if (nameInput) setTimeout(() => nameInput.focus(), 300);
          }
        }
      }
    });
  }

  function addSwipeHandler(element, id) {
    let xDown = null;
    let yDown = null;

    element.addEventListener('touchstart', function (evt) {
      xDown = evt.touches[0].clientX;
      yDown = evt.touches[0].clientY;
      element.classList.remove('swiped-left');
    }, { passive: true });

    element.addEventListener('touchmove', function (evt) {
      if (!xDown || !yDown) return;

      const xUp = evt.touches[0].clientX;
      const yUp = evt.touches[0].clientY;

      const xDiff = xDown - xUp;
      const yDiff = yDown - yUp;

      if (Math.abs(xDiff) > Math.abs(yDiff)) {
        if (xDiff > 0) {
          // Swipe Left -> Visual feedback
          if (xDiff > 50) {
            element.style.transform = `translateX(-${xDiff}px)`;
          }
        } else {
          element.style.transform = 'translateX(0)';
        }
      }
    }, { passive: true });

    element.addEventListener('touchend', function (evt) {
      if (!xDown) return;
      const xUp = evt.changedTouches[0].clientX;
      const xDiff = xDown - xUp;

      element.style.transform = '';

      // Threshold for Delete Trigger
      if (xDiff > 100) {
        // Trigger Delete (with confirmation as per requirement)
        // User requirement: "Confirm before delete"
        if (confirm('Delete this item?')) {
          deleteProduct(id, true); // true = skip second confirm, we just asked
        }
      }

      xDown = null;
      yDown = null;
    });
  }

  function renderAnalysis() {
    const canvas = document.getElementById('priceChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const categoryTotals = {};
    inventory.forEach(item => {
      categoryTotals[item.category] = (categoryTotals[item.category] || 0) + Number(item.price);
    });

    const labels = Object.keys(categoryTotals);
    const data = Object.values(categoryTotals);
    // ... rest of chart logic ...
    // Using existing valid chart logic from context
    const backgroundColors = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

    if (myChart) myChart.destroy();
    myChart = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: labels,
        datasets: [{ data: data, backgroundColor: backgroundColors }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' },
          title: { display: true, text: 'Inventory Value by Category' }
        }
      }
    });

    const details = document.getElementById('analysis-details');
    if (details) {
      details.innerHTML = labels.map((cat, i) => `
        <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
          <span>${cat}</span>
          <b>₹${data[i].toFixed(2)}</b>
        </div>
      `).join('');
    }
  }

  // --- Visualization Tab Logic ---
  const vizSection = document.getElementById('visualization-section');
  const closeVizBtn = document.getElementById('close-viz-btn');
  const vizBtn = document.getElementById('menu-viz');
  const vizTimeFilter = document.getElementById('viz-time-filter');
  const budgetInput = document.getElementById('budget-input');
  const budgetWarning = document.getElementById('budget-warning');
  const categoryListContainer = document.getElementById('category-list');

  let categoryChart = null;
  let trendChart = null;

  const CHART_COLORS = [
    '#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#ef4444'
  ];

  /* Event Listeners */
  if (vizBtn) {
    vizBtn.addEventListener('click', () => {
      if (fabMenu) fabMenu.classList.add('hidden');
      if (analysisModal) analysisModal.classList.add('hidden');
      if (aiModal) aiModal.classList.add('hidden');
      openVisualization();
    });
  }

  if (closeVizBtn) {
    closeVizBtn.addEventListener('click', () => vizSection.classList.add('hidden'));
  }

  if (vizTimeFilter) {
    vizTimeFilter.addEventListener('change', () => calculateAndRenderViz());
  }

  if (budgetInput) {
    budgetInput.addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val)) {
        localStorage.setItem('smart_expiry_budget', val);
        calculateAndRenderViz();
      }
    });
  }

  function openVisualization() {
    vizSection.classList.remove('hidden');
    const savedBudget = localStorage.getItem('smart_expiry_budget');
    if (savedBudget && budgetInput) {
      budgetInput.value = savedBudget;
    }
    calculateAndRenderViz();
  }

  function calculateAndRenderViz() {
    let totalValue = 0;
    const categoryCosts = {};

    inventory.forEach(item => {
      const quantity = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.price) || 0;
      const cost = price * quantity;

      totalValue += cost;
      categoryCosts[item.category] = (categoryCosts[item.category] || 0) + cost;
    });

    const budget = parseFloat(localStorage.getItem('smart_expiry_budget')) || 0;

    const totalEl = document.getElementById('total-inventory-value');
    if (totalEl) totalEl.textContent = `₹${totalValue.toFixed(2)}`;

    if (budgetWarning) {
      if (budget > 0 && totalValue > budget) {
        budgetWarning.classList.remove('hidden');
      } else {
        budgetWarning.classList.add('hidden');
      }
    }

    renderCategoryPieChart(categoryCosts);
    renderCategoryList(categoryCosts, totalValue);
    renderTrendChart(vizTimeFilter ? vizTimeFilter.value : 'monthly', budget);
  }

  function renderCategoryPieChart(categoryCosts) {
    const canvas = document.getElementById('categoryPieChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const labels = Object.keys(categoryCosts).map(cat => {
      return cat;
    });
    const data = Object.values(categoryCosts);

    if (categoryChart) categoryChart.destroy();

    categoryChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: CHART_COLORS.slice(0, data.length),
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'right',
            labels: { boxWidth: 12, font: { size: 10 } }
          }
        }
      }
    });
  }

  function renderCategoryList(categoryCosts, totalValue) {
    const container = document.getElementById('category-list');
    if (!container) return;

    const sortedCats = Object.entries(categoryCosts).sort((a, b) => b[1] - a[1]);

    container.innerHTML = sortedCats.map(([cat, cost], i) => {
      const percent = totalValue > 0 ? ((cost / totalValue) * 100).toFixed(1) : 0;
      const color = CHART_COLORS[i % CHART_COLORS.length];

      const displayCat = cat;

      return `
            <div style="display: flex; align-items: center; margin-bottom: 0.75rem;">
               <div style="width: 12px; height: 12px; border-radius: 3px; background: ${color}; margin-right: 0.75rem;"></div>
               <div style="flex: 1;">
                  <div style="display: flex; justify-content: space-between; font-size: 0.9rem;">
                     <span style="font-weight: 500;">${displayCat}</span>
                     <span>₹${cost.toFixed(2)}</span>
                  </div>
                  <div style="background: var(--background); height: 6px; border-radius: 3px; margin-top: 4px; overflow: hidden;">
                     <div style="width: ${percent}%; background: ${color}; height: 100%;"></div>
                  </div>
               </div>
            </div>
          `;
    }).join('');
  }


  function renderTrendChart(period, budget) {
    const canvas = document.getElementById('trendBarChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const today = new Date();
    let labels = [];
    let data = [];
    if (period === 'monthly') {
      labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthlyData = new Array(12).fill(0);
      inventory.forEach(item => {
        const d = new Date(item.created_at);
        if (d.getFullYear() === today.getFullYear()) {
          const cost = (parseFloat(item.price) || 0) * (parseFloat(item.quantity) || 0);
          monthlyData[d.getMonth()] += cost;
        }
      });
      data = monthlyData;
    } else {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const last7Days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(today.getDate() - i);
        last7Days.push(d);
      }
      labels = last7Days.map(d => dayNames[d.getDay()]);
      data = last7Days.map(dateObj => {
        let dailyTotal = 0;
        inventory.forEach(item => {
          const itemDate = new Date(item.created_at);
          if (itemDate.toDateString() === dateObj.toDateString()) {
            dailyTotal += (parseFloat(item.price) || 0) * (parseFloat(item.quantity) || 0);
          }
        });
        return dailyTotal;
      });
    }

    if (trendChart) trendChart.destroy();

    // ... trend chart config ...
    trendChart = new Chart(ctx, {
      data: {
        labels: labels, datasets: [{
          type: 'bar', label: 'Spending', data: data, backgroundColor: '#4F46E5', borderRadius: 4
        }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }

  // --- FCM Logic (Auto PWA) ---
  // Request permission automatically on load if supported
  if ('Notification' in window) {
    if (Notification.permission === 'default') {
      // Attempt to request if not denied
      // Browsers usually block this if not user triggered, but PWA context might allow it or user asked it "On load".
      // We'll wrap in a small timeout or try immediately.
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') initFCM();
      });
    } else if (Notification.permission === 'granted') {
      initFCM();
    }
  }

  async function initFCM() {
    if (!window.messaging) return;
    try {
      const currentToken = await window.getToken(window.messaging, {});
      if (currentToken) {
        localStorage.setItem('fcmToken', currentToken);
        saveTokenToSupabase(currentToken);
      }
      window.onMessage(window.messaging, (payload) => {
        const { title, body } = payload.notification;
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistration().then(reg => {
            if (reg) reg.showNotification(title, { body, icon: './android-launchericon-192-192.png' });
          });
        } else {
          new Notification(title, { body });
        }
      });
    } catch (err) {
      console.error('FCM Init Error:', err);
    }
  }

  async function saveTokenToSupabase(token) {
    if (!currentUser) return;
    await supabase.from('fcm_tokens').upsert({
      user_id: currentUser.id,
      token: token,
      updated_at: new Date()
    }, { onConflict: 'token' });
  }

  // --- AI Dashboard Logic ---
  const aiSection = document.getElementById('ai-dashboard-section');
  const aiBtn = document.getElementById('menu-ai');
  const closeAiBtn = document.getElementById('close-ai-btn'); // Matches HTML ID
  const aiInput = document.getElementById('ai-user-input');
  const aiSendBtn = document.getElementById('ai-send-btn');
  const aiChatContainer = document.getElementById('ai-chat-container');
  const aiChipsContainer = document.getElementById('ai-inventory-chips');
  const aiMicBtn = document.getElementById('ai-mic-btn');

  // Toggle AI Dashboard
  if (aiBtn) {
    aiBtn.addEventListener('click', () => {
      // Hide others
      if (fabMenu) fabMenu.classList.add('hidden');
      if (analysisModal) analysisModal.classList.add('hidden');
      if (aiModal) aiModal.classList.add('hidden'); // The old modal
      if (vizSection) vizSection.classList.add('hidden');

      openAIDashboard();
    });
  }

  if (closeAiBtn) {
    closeAiBtn.addEventListener('click', () => {
      aiSection.classList.add('hidden');
    });
  }

  function openAIDashboard() {
    aiSection.classList.remove('hidden');
    renderInventoryChips();
    // Scroll to bottom of chat
    aiChatContainer.scrollTop = aiChatContainer.scrollHeight;
    aiInput.focus();
  }

  function renderInventoryChips() {
    if (!aiChipsContainer) return;
    aiChipsContainer.innerHTML = '';

    // Sort logic? Just basic list
    const topItems = inventory.slice(0, 10); // Take top 10 for simplicity or all? user said "ALL" logic for AI, chips just preview

    topItems.forEach(item => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.textContent = `${item.name} (${item.quantity}${item.unit})`;
      chip.onclick = () => {
        aiInput.value += (aiInput.value ? ' ' : '') + item.name;
        aiInput.focus();
      };
      aiChipsContainer.appendChild(chip);
    });
  }

  // AI Chat Send
  if (aiSendBtn) {
    aiSendBtn.addEventListener('click', sendMessageToAI);
  }

  if (aiInput) {
    aiInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessageToAI();
    });
  }

  async function sendMessageToAI() {
    const text = aiInput.value.trim();
    if (!text) return;

    // 1. Add User Bubble
    addChatBubble(text, 'user');
    aiInput.value = '';

    // 2. Add Loading Bubble
    const loadingId = addChatBubble('<div class="typing-indicator"><span></span><span></span><span></span></div>', 'ai', true);

    try {
      // 3. Call Backend
      // URL based on local env or production. For now assuming localhost:3000 as per plan
      // In real deploy, this URL should be dynamic
      const response = await fetch("https://smart-household-assistant-back.onrender.com/api/chat", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          inventory: inventory.map(i => ({ name: i.name, quantity: i.quantity, unit: i.unit })),
          language: 'en' // Default language
        })
      });

      const data = await response.json();

      // 4. Remove Loading & Add AI Response
      removeChatBubble(loadingId);
      if (data.reply) {
        addChatBubble(data.reply, 'ai');
      } else {
        addChatBubble("Chef AI is taking a nap. Try again later!", 'ai');
      }

    } catch (err) {
      console.error(err);
      removeChatBubble(loadingId);
      addChatBubble("⚠️ Connection error. Is the backend running?", 'ai');
    }
  }

  function addChatBubble(html, type, returnId = false) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${type}-bubble`;
    bubble.innerHTML = html;

    const id = 'bubble-' + Date.now();
    bubble.id = id;

    aiChatContainer.appendChild(bubble);
    aiChatContainer.scrollTop = aiChatContainer.scrollHeight;

    return returnId ? id : null;
  }

  function removeChatBubble(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  // AI Voice Input
  if (aiMicBtn && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const aiRecognition = new SpeechRecognition();
    aiRecognition.continuous = false;
    aiRecognition.lang = 'en-US';

    aiMicBtn.addEventListener('click', () => {
      aiMicBtn.style.color = 'var(--danger)';



      aiRecognition.start();
    });

    aiRecognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      aiInput.value = transcript;
      aiMicBtn.style.color = 'var(--primary)';
      // Optional: Auto send? Let's verify first.
      aiInput.focus();
    };

    aiRecognition.onerror = () => { aiMicBtn.style.color = 'var(--primary)'; };
    aiRecognition.onend = () => { aiMicBtn.style.color = 'var(--primary)'; };
  } else if (aiMicBtn) {
    aiMicBtn.style.display = 'none';
  }

  // Add Swipe to AI Dashboard (Back to Main)
  if (aiSection) {
    let aiStartX = 0;
    let aiStartY = 0;

    aiSection.addEventListener('touchstart', e => {
      aiStartX = e.touches[0].clientX;
      aiStartY = e.touches[0].clientY;
    }, { passive: true });

    aiSection.addEventListener('touchend', e => {
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const diffX = endX - aiStartX;
      const diffY = endY - aiStartY;

      // Swipe Right (Positive X) -> Close
      if (Math.abs(diffX) > Math.abs(diffY) && diffX > 80 && Math.abs(diffX) > 100) {
        aiSection.classList.add('hidden');
      }
    });
  }

});

