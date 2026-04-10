<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { Github, Copy, ExternalLink, Loader2, AlertCircle, Check, ClipboardCheck } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const copied = ref(false);
const isAddingAccount = computed(() => !!route.query.addAccount);

// Navigate to landing page when user gains access (only for fresh login, not add-account)
watch(
  () => auth.hasAccess,
  (hasAccess) => {
    if (hasAccess && !isAddingAccount.value) router.replace('/');
  }
);

// When adding account: watch for device flow success → navigate back
watch(
  () => auth.deviceFlowStatus?.status,
  (status) => {
    if (isAddingAccount.value && status === 'success') {
      router.replace('/');
    }
  }
);

// Auto-start device flow when adding account
onMounted(() => {
  if (isAddingAccount.value) {
    auth.login();
  }
});

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
    copied.value = true;
    setTimeout(() => (copied.value = false), 3000);
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
          <div class="space-y-5">
            <!-- Step 1: Copy the code -->
            <div class="space-y-2">
              <div class="flex items-center gap-2 text-sm font-medium">
                <span class="flex items-center justify-center h-5 w-5 rounded-full text-xs"
                  :class="copied ? 'bg-green-500/20 text-green-400' : 'bg-primary/20 text-primary'">
                  <Check v-if="copied" class="h-3 w-3" />
                  <span v-else>1</span>
                </span>
                Copy your login code
              </div>

              <button data-testid="copy-code-button"
                class="w-full group relative font-mono text-2xl font-bold tracking-widest py-3 px-4 bg-muted rounded-lg text-center cursor-pointer border border-transparent transition-colors hover:border-primary/40 active:scale-[0.98]"
                @click="copyCode">
                {{ auth.deviceFlowStatus.userCode }}
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground group-hover:text-primary transition-colors">
                  <ClipboardCheck v-if="copied" class="h-4 w-4 text-green-400" />
                  <Copy v-else class="h-4 w-4" />
                </span>
              </button>
              <p v-if="copied" class="text-xs text-green-400 text-center">Copied!</p>
            </div>

            <!-- Step 2: Open GitHub -->
            <div class="space-y-2">
              <div class="flex items-center gap-2 text-sm font-medium">
                <span class="flex items-center justify-center h-5 w-5 rounded-full bg-primary/20 text-primary text-xs">2</span>
                Paste the code on GitHub
              </div>

              <Button class="w-full" data-testid="open-github-button" @click="openGitHub">
                <ExternalLink class="h-4 w-4 mr-2" />
                Open GitHub
              </Button>
            </div>

            <div class="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-1">
              <Loader2 class="h-3 w-3 animate-spin" />
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
