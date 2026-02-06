import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

// Lazy load views for better performance
const LandingPage = () => import('@/views/LandingPage.vue');
const ProjectOverview = () => import('@/views/ProjectOverview.vue');
const SearchPage = () => import('@/views/SearchPage.vue');
const LoadPage = () => import('@/views/LoadPage.vue');
const PrepPage = () => import('@/views/PrepPage.vue');
const DedupePage = () => import('@/views/DedupePage.vue');
const PrescreenPage = () => import('@/views/PrescreenPage.vue');
const PdfGetPage = () => import('@/views/PdfGetPage.vue');
const PdfPrepPage = () => import('@/views/PdfPrepPage.vue');
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
        path: 'search',
        name: 'project-search',
        component: SearchPage,
        meta: {
          title: 'Search',
          step: 'search',
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
        path: 'pdf-get',
        name: 'project-pdf-get',
        component: PdfGetPage,
        meta: {
          title: 'PDF Get',
          step: 'pdf_get',
        },
      },
      {
        path: 'pdf-prep',
        name: 'project-pdf-prep',
        component: PdfPrepPage,
        meta: {
          title: 'PDF Prep',
          step: 'pdf_prep',
        },
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
