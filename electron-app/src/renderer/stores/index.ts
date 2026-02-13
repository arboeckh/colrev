// Re-export all stores
export { useBackendStore } from './backend';
export { useProjectsStore } from './projects';
export { useNotificationsStore } from './notifications';
export { useDebugStore } from './debug';
export { useThemeStore } from './theme';
export { useAuthStore } from './auth';

export type { BackendStatus, SearchProgress } from './backend';
export type { ProjectListItem } from './projects';
export type { NotificationType, Notification } from './notifications';
export type { DebugLogEntry } from './debug';
export type { Theme } from './theme';
