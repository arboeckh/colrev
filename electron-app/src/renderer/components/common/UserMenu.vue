<script setup lang="ts">
import { useRouter } from 'vue-router';
import { User, LogOut, Github, EllipsisVertical, Check, Plus } from 'lucide-vue-next';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
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

function handleAddAccount() {
  router.push('/login?addAccount=1');
}

async function handleSwitchAccount(login: string) {
  const result = await auth.switchAccount(login);
  if (result) {
    // Full reload — token changed, all project data / collaborators / git state is stale
    window.location.reload();
  }
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
      <!-- Account list (when multiple accounts) -->
      <template v-if="auth.accounts.length > 1">
        <DropdownMenuLabel class="text-xs text-muted-foreground font-normal">Switch account</DropdownMenuLabel>
        <DropdownMenuItem
          v-for="account in auth.accounts"
          :key="account.login"
          class="gap-2"
          @click="handleSwitchAccount(account.login)"
        >
          <Avatar class="h-5 w-5 shrink-0">
            <AvatarImage :src="account.avatarUrl" />
            <AvatarFallback class="text-[9px] bg-muted">
              <User class="h-3 w-3" />
            </AvatarFallback>
          </Avatar>
          <span class="flex-1 truncate text-sm">{{ account.name || account.login }}</span>
          <Check v-if="account.isActive" class="h-3.5 w-3.5 shrink-0 text-primary" />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
      </template>

      <!-- Add another account -->
      <DropdownMenuItem v-if="auth.isAuthenticated" @click="handleAddAccount">
        <Plus class="h-4 w-4 mr-2" />
        Add account
      </DropdownMenuItem>

      <!-- Sign out -->
      <DropdownMenuItem v-if="auth.isAuthenticated" data-testid="sign-out-button" @click="handleSignOut">
        <LogOut class="h-4 w-4 mr-2" />
        Sign out
      </DropdownMenuItem>

      <!-- Sign in (when not authenticated) -->
      <DropdownMenuItem v-if="!auth.isAuthenticated" @click="handleSignIn">
        <Github class="h-4 w-4 mr-2" />
        Sign in with GitHub
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
