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
const ManagedReviewWorkflowPage = () => import('@/views/ManagedReviewWorkflowPage.vue');
const PdfsPage = () => import('@/views/PdfsPage.vue');
const PreprocessingPage = () => import('@/views/PreprocessingPage.vue');
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
        name: 'project-preprocessing',
        component: PreprocessingPage,
        meta: {
          title: 'Preprocessing',
          step: 'preprocessing',
        },
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
        component: ManagedReviewWorkflowPage,
        meta: {
          title: 'Prescreen',
          step: 'prescreen',
          managedReviewKind: 'prescreen',
        },
      },
      {
        path: 'prescreen-launch',
        redirect: (to) => ({ name: 'project-prescreen', params: { id: to.params.id } }),
      },
      {
        path: 'prescreen-reconcile',
        redirect: (to) => ({ name: 'project-prescreen', params: { id: to.params.id } }),
      },
      {
        path: 'pdfs',
        redirect: (to) => ({ name: 'project-pdf-get', params: { id: to.params.id } }),
      },
      {
        path: 'pdf-get',
        name: 'project-pdf-get',
        component: PdfsPage,
        meta: {
          title: 'PDF Get',
          step: 'pdf_get',
        },
      },
      {
        path: 'pdf-prep',
        name: 'project-pdf-prep',
        component: PdfsPage,
        meta: {
          title: 'PDF Prep',
          step: 'pdf_prep',
        },
      },
      {
        path: 'screen',
        name: 'project-screen',
        component: ManagedReviewWorkflowPage,
        meta: {
          title: 'Screen',
          step: 'screen',
          managedReviewKind: 'screen',
        },
      },
      {
        path: 'screen-launch',
        redirect: (to) => ({ name: 'project-screen', params: { id: to.params.id } }),
      },
      {
        path: 'screen-reconcile',
        redirect: (to) => ({ name: 'project-screen', params: { id: to.params.id } }),
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
    // If already authenticated, redirect to landing — unless adding another account
    if (auth.hasAccess && !to.query.addAccount) return '/';
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
    managedReviewKind?: 'prescreen' | 'screen';
  }
}
