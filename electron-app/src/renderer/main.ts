import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './index.css';

// Import window type declarations
import './types/window.d';

const app = createApp(App);

// Install Pinia for state management
const pinia = createPinia();
app.use(pinia);

// Install Vue Router
app.use(router);

// Mount the app
app.mount('#app');
