// Shared Supabase Initialization
// This file ensures Supabase is initialized only once and available globally.

const SUPABASE_URL = 'https://tqfpqzlirfuuxrdhjjix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZnBxemxpcmZ1dXhyZGhqaml4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MjAxODYsImV4cCI6MjA4NjM5NjE4Nn0.4gLt1mhql4EMuHs6JyZWRJLGClKtkmzmkC9s1zTwPN4';

// Check if supabase object exists from the CDN script
if (window.supabase) {
    // Initialize client and attach to window to avoid re-declaration errors
    window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('Supabase Initialized');
} else {
    console.error('Supabase JS library not loaded!');
}
