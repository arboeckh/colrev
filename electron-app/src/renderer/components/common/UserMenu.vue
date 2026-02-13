<script setup lang="ts">
import { useRouter } from 'vue-router';
import { User, LogOut, Github, EllipsisVertical } from 'lucide-vue-next';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();

async function handleSignOut() {
  await auth.logout();
  router.push('/login');
}

function handleSignIn() {
  auth.isLocalMode = false;
  router.push('/login');
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger
      data-testid="user-menu-trigger"
      class="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm outline-none hover:bg-accent transition-colors"
    >
      <Avatar class="h-8 w-8 shrink-0">
        <AvatarImage v-if="auth.isAuthenticated && auth.user?.avatarUrl" :src="auth.user.avatarUrl" />
        <AvatarFallback class="bg-muted">
          <User class="h-4 w-4" />
        </AvatarFallback>
      </Avatar>

      <div v-if="auth.isAuthenticated" class="flex-1 min-w-0">
        <p class="truncate text-sm font-medium leading-none">{{ auth.user?.name || auth.user?.login }}</p>
        <p class="truncate text-xs text-muted-foreground mt-0.5">{{ auth.user?.email || `@${auth.user?.login}` }}</p>
      </div>
      <div v-else class="flex-1 min-w-0">
        <p class="text-sm text-muted-foreground">Local Mode</p>
      </div>

      <EllipsisVertical class="h-4 w-4 shrink-0 text-muted-foreground" />
    </DropdownMenuTrigger>

    <DropdownMenuContent align="end" side="top" class="w-[--reka-dropdown-menu-trigger-width]">
      <DropdownMenuItem v-if="auth.isAuthenticated" data-testid="sign-out-button" @click="handleSignOut">
        <LogOut class="h-4 w-4 mr-2" />
        Sign out
      </DropdownMenuItem>

      <DropdownMenuItem v-else @click="handleSignIn">
        <Github class="h-4 w-4 mr-2" />
        Sign in with GitHub
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
