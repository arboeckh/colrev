import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

// Lazy load views for better performance
const LandingPage = () => import('@/views/LandingPage.vue');
const ProjectOverview = () => import('@/views/ProjectOverview.vue');
const ReviewDefinitionPage = () => import('@/views/ReviewDefinitionPage.vue');
const SearchPage = () => import('@/views/SearchPage.vue');
const PreprocessingPage = () => import('@/views/PreprocessingPage.vue');
const LoadPage = () => import('@/views/LoadPage.vue');
const PrepPage = () => import('@/views/PrepPage.vue');
const DedupePage = () => import('@/views/DedupePage.vue');
const PrescreenPage = () => import('@/views/PrescreenPage.vue');
const PdfsPage = () => import('@/views/PdfsPage.vue');
const ScreenPage = () => import('@/views/ScreenPage.vue');
const DataPage = () => import('@/views/DataPage.vue');
const SettingsPage = () => import('@/views/SettingsPage.vue');

const routes: RouteRecordRaw[] = [
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
        component: PrescreenPage,
        meta: {
          title: 'Prescreen',
          step: 'prescreen',
        },
      },
      {
        path: 'pdfs',
        name: 'project-pdfs',
        component: PdfsPage,
        meta: {
          title: 'PDFs',
          step: 'pdfs',
        },
      },
      {
        path: 'pdf-get',
        redirect: (to) => ({ name: 'project-pdfs', params: { id: to.params.id } }),
      },
      {
        path: 'pdf-prep',
        redirect: (to) => ({ name: 'project-pdfs', params: { id: to.params.id } }),
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

// Navigation guard for project routes
router.beforeEach((to, _from, next) => {
  // Update document title
  const title = to.meta.title as string | undefined;
  if (title) {
    document.title = title === 'CoLRev' ? title : `${title} - CoLRev`;
  }

  next();
});

export default router;

// Type augmentation for route meta
declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    layout?: 'none' | 'project';
    step?: string | null;
  }
}
