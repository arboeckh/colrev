import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

// Lazy load views for better performance
const LandingPage = () => import('@/views/LandingPage.vue');
const LoginPage = () => import('@/views/LoginPage.vue');
const ProjectOverview = () => import('@/views/ProjectOverview.vue');
const ReviewDefinitionPage = () => import('@/views/ReviewDefinitionPage.vue');
const SearchPage = () => import('@/views/SearchPage.vue');
const LoadPage = () => import('@/views/LoadPage.vue');
const PrepPage = () => import('@/views/PrepPage.vue');
const DedupePage = () => import('@/views/DedupePage.vue');
const PrescreenPage = () => import('@/views/PrescreenPage.vue');
const ScreenPage = () => import('@/views/ScreenPage.vue');
const DataPage = () => import('@/views/DataPage.vue');
const SettingsPage = () => import('@/views/SettingsPage.vue');

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: LoginPage,
    meta: {
      title: 'Sign In - CoLRev',
      layout: 'none',
      public: true,
    },
  },
  {
    path: '/',
    name: 'landing',
    component: LandingPage,
    meta: {
      title: 'CoLRev',
      layout: 'none',
    },
  },
  {
    path: '/project/:id',
    name: 'project',
    redirect: (to) => ({ name: 'project-overview', params: { id: to.params.id } }),
    meta: {
      layout: 'project',
    },
    children: [
      {
        path: '',
        name: 'project-overview',
        component: ProjectOverview,
        meta: {
          title: 'Overview',
          step: null,
        },
      },
      {
        path: 'review-definition',
        name: 'project-review-definition',
        component: ReviewDefinitionPage,
        meta: {
          title: 'Definition',
          step: 'review_definition',
        },
      },
      {
        path: 'search',
        name: 'project-search',
        component: SearchPage,
        meta: {
          title: 'Search',
          step: 'search',
        },
      },
      {
        path: 'preprocessing',
        redirect: (to) => ({ name: 'project-search', params: { id: to.params.id } }),
      },
      {
        path: 'load',
        name: 'project-load',
        component: LoadPage,
        meta: {
          title: 'Load',
          step: 'load',
        },
      },
      {
        path: 'prep',
        name: 'project-prep',
        component: PrepPage,
        meta: {
          title: 'Prep',
          step: 'prep',
        },
      },
      {
        path: 'dedupe',
        name: 'project-dedupe',
        component: DedupePage,
        meta: {
          title: 'Dedupe',
          step: 'dedupe',
        },
      },
      {
        path: 'prescreen',
        name: 'project-prescreen',
        component: PrescreenPage,
        meta: {
          title: 'Prescreen',
          step: 'prescreen',
        },
      },
      {
        path: 'pdfs',
        redirect: (to) => ({ name: 'project-screen', params: { id: to.params.id } }),
      },
      {
        path: 'pdf-get',
        redirect: (to) => ({ name: 'project-screen', params: { id: to.params.id } }),
      },
      {
        path: 'pdf-prep',
        redirect: (to) => ({ name: 'project-screen', params: { id: to.params.id } }),
      },
      {
        path: 'screen',
        name: 'project-screen',
        component: ScreenPage,
        meta: {
          title: 'Screen',
          step: 'screen',
        },
      },
      {
        path: 'data',
        name: 'project-data',
        component: DataPage,
        meta: {
          title: 'Data',
          step: 'data',
        },
      },
      {
        path: 'settings',
        name: 'project-settings',
        component: SettingsPage,
        meta: {
          title: 'Settings',
          step: null,
        },
      },
    ],
  },
  // Catch-all redirect to landing page
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// Navigation guard for auth and title
router.beforeEach(async (to, _from) => {
  // Update document title
  const title = to.meta.title as string | undefined;
  if (title) {
    document.title = title === 'CoLRev' ? title : `${title} - CoLRev`;
  }

  const auth = useAuthStore();

  // Wait for auth to finish loading
  if (auth.isLoading) {
    await new Promise<void>((resolve) => {
      const unwatch = auth.$subscribe(() => {
        if (!auth.isLoading) {
          unwatch();
          resolve();
        }
      });
      // Resolve immediately if already done
      if (!auth.isLoading) {
        unwatch();
        resolve();
      }
    });
  }

  // Public routes (login page)
  if (to.meta.public) {
    // If already authenticated, redirect to landing
    if (auth.hasAccess) return '/';
    return;
  }

  // Protected routes — redirect to login if no access
  if (!auth.hasAccess) {
    return '/login';
  }
});

export default router;

// Type augmentation for route meta
declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    layout?: 'none' | 'project';
    step?: string | null;
    public?: boolean;
  }
}
