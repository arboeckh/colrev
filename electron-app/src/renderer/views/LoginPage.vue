<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Github, Copy, ExternalLink, Loader2, AlertCircle } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();

// Navigate to landing page when user gains access
watch(
  () => auth.hasAccess,
  (hasAccess) => {
    if (hasAccess) router.replace('/');
  }
);

const isPolling = computed(
  () => auth.deviceFlowStatus?.status === 'polling' || auth.deviceFlowStatus?.status === 'awaiting_code'
);
const hasError = computed(
  () => auth.deviceFlowStatus?.status === 'error' || auth.deviceFlowStatus?.status === 'expired'
);
const errorMessage = computed(() => {
  if (auth.deviceFlowStatus?.status === 'expired') return 'The code expired. Please try again.';
  return auth.deviceFlowStatus?.error || 'Something went wrong. Please try again.';
});

async function copyCode() {
  const code = auth.deviceFlowStatus?.userCode;
  if (code) {
    await navigator.clipboard.writeText(code);
  }
}

function openGitHub() {
  const uri = auth.deviceFlowStatus?.verificationUri;
  if (uri) {
    window.open(uri, '_blank');
  }
}
</script>

<template>
  <div class="min-h-screen bg-background flex items-center justify-center p-4">
    <Card class="w-full max-w-xs">
      <CardHeader class="text-center">
        <CardTitle class="text-2xl font-bold">CoLRev</CardTitle>
        <CardDescription>Collaborative Literature Reviews</CardDescription>
      </CardHeader>

      <CardContent class="space-y-6">
        <!-- Device Flow: Show code and polling state -->
        <template v-if="isPolling && auth.deviceFlowStatus?.userCode">
          <div class="text-center space-y-4">
            <p class="text-sm text-muted-foreground">
              Enter this code on GitHub to sign in:
            </p>

            <div data-testid="device-code-display"
              class="font-mono text-3xl font-bold tracking-widest py-3 px-4 bg-muted rounded-lg select-all">
              {{ auth.deviceFlowStatus.userCode }}
            </div>

            <div class="flex justify-center gap-2">
              <Button variant="outline" size="sm" data-testid="copy-code-button" @click="copyCode">
                <Copy class="h-4 w-4 mr-2" />
                Copy code
              </Button>
              <Button variant="outline" size="sm" data-testid="open-github-button" @click="openGitHub">
                <ExternalLink class="h-4 w-4 mr-2" />
                Open GitHub
              </Button>
            </div>

            <div class="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 class="h-4 w-4 animate-spin" />
              Waiting for authorization...
            </div>
          </div>
        </template>

        <!-- Awaiting code (loading) -->
        <template v-else-if="auth.deviceFlowStatus?.status === 'awaiting_code'">
          <div class="flex items-center justify-center py-8">
            <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </template>

        <!-- Error state -->
        <template v-else-if="hasError">
          <div class="text-center space-y-4">
            <div class="flex items-center justify-center gap-2 text-destructive">
              <AlertCircle class="h-5 w-5" />
              <span class="text-sm">{{ errorMessage }}</span>
            </div>
            <Button class="w-full" data-testid="login-github-button" @click="auth.login()">
              <Github class="h-4 w-4 mr-2" />
              Try again
            </Button>
          </div>
        </template>

        <!-- Initial state -->
        <template v-else>
          <div class="space-y-3">
            <Button class="w-full" data-testid="login-github-button" @click="auth.login()">
              <Github class="h-4 w-4 mr-2" />
              Sign in with GitHub
            </Button>

            <div class="relative">
              <div class="absolute inset-0 flex items-center">
                <span class="w-full border-t" />
              </div>
              <div class="relative flex justify-center text-xs uppercase">
                <span class="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <Button variant="ghost" class="w-full text-muted-foreground" data-testid="continue-without-login"
              @click="auth.continueWithoutLogin()">
              Continue without login
            </Button>
          </div>
        </template>
      </CardContent>
    </Card>
  </div>
</template>
