<script setup lang="ts">
import { computed } from 'vue';
import { KeyRound } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();

const open = computed({
  get: () => auth.keychainExplainerOpen,
  set: (value: boolean) => {
    if (!value) auth.acknowledgeKeychainExplainer();
  },
});

function continueClick() {
  auth.acknowledgeKeychainExplainer();
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="z-[200] sm:max-w-[480px]"
      data-testid="keychain-explainer-dialog"
      :show-close-button="false"
    >
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <KeyRound class="h-5 w-5 text-primary" />
          One-time system prompt
        </DialogTitle>
        <DialogDescription class="pt-2 text-left leading-relaxed">
          ColRev saves your GitHub sign-in to your macOS Keychain so you don't have to
          sign in again.
          <br /><br />
          macOS will ask for permission once — choose
          <span class="font-semibold text-foreground">"Always Allow"</span>
          to avoid seeing the prompt again.
          <br /><br />
          <span class="text-xs text-muted-foreground">
            The name shown in the system dialog is "ColRev Safe Storage". This is expected.
          </span>
        </DialogDescription>
      </DialogHeader>

      <DialogFooter>
        <Button data-testid="keychain-explainer-continue" @click="continueClick">
          Continue
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
