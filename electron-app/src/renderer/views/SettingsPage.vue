<script setup lang="ts">
import { Settings, Save, User, FileText, GitBranch } from 'lucide-vue-next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useProjectsStore } from '@/stores/projects';

const projects = useProjectsStore();

const settings = projects.currentSettings;
</script>

<template>
  <div class="p-6 space-y-6">
    <!-- Page header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <Settings class="h-6 w-6" />
          Settings
        </h2>
        <p class="text-muted-foreground">Project configuration and preferences</p>
      </div>

      <Button disabled>
        <Save class="h-4 w-4 mr-2" />
        Save Changes
      </Button>
    </div>

    <Separator />

    <!-- Project info -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <FileText class="h-5 w-5" />
          Project Information
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid gap-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">Project Title</label>
            <Input
              :model-value="settings?.project?.title || ''"
              disabled
              placeholder="Project title"
            />
          </div>

          <div class="space-y-2">
            <label class="text-sm font-medium">Keywords</label>
            <div class="flex flex-wrap gap-2">
              <Badge
                v-for="keyword in settings?.project?.keywords || []"
                :key="keyword"
                variant="secondary"
              >
                {{ keyword }}
              </Badge>
              <span v-if="!settings?.project?.keywords?.length" class="text-sm text-muted-foreground">
                No keywords defined
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Authors -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <User class="h-5 w-5" />
          Authors
        </CardTitle>
        <CardDescription>Project team members</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-3">
          <div
            v-for="author in settings?.project?.authors || []"
            :key="author.name"
            class="flex items-center justify-between p-3 bg-muted rounded-md"
          >
            <div>
              <span class="font-medium">{{ author.name }}</span>
              <span v-if="author.initials" class="text-muted-foreground ml-2">({{ author.initials }})</span>
            </div>
            <span v-if="author.email" class="text-sm text-muted-foreground">{{ author.email }}</span>
          </div>

          <div v-if="!settings?.project?.authors?.length" class="text-sm text-muted-foreground">
            No authors defined
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Git info -->
    <Card v-if="projects.currentGitStatus">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <GitBranch class="h-5 w-5" />
          Git Repository
        </CardTitle>
        <CardDescription>Version control information</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">Branch</span>
            <Badge variant="secondary" class="font-mono">{{ projects.currentGitStatus.branch }}</Badge>
          </div>

          <div v-if="projects.currentGitStatus.remote_url" class="flex items-center justify-between">
            <span class="text-muted-foreground">Remote</span>
            <span class="text-sm font-mono truncate max-w-[300px]">
              {{ projects.currentGitStatus.remote_url }}
            </span>
          </div>

          <div v-if="projects.currentGitStatus.last_commit" class="pt-3 border-t">
            <span class="text-sm font-medium">Last Commit</span>
            <div class="mt-2 p-3 bg-muted rounded-md text-sm">
              <div class="font-mono text-xs text-muted-foreground mb-1">
                {{ projects.currentGitStatus.last_commit.hash.slice(0, 8) }}
              </div>
              <div>{{ projects.currentGitStatus.last_commit.message }}</div>
              <div class="text-muted-foreground text-xs mt-1">
                {{ projects.currentGitStatus.last_commit.author }} &middot;
                {{ new Date(projects.currentGitStatus.last_commit.date).toLocaleDateString() }}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Search sources summary -->
    <Card v-if="settings?.sources?.length">
      <CardHeader>
        <CardTitle>Search Sources</CardTitle>
        <CardDescription>{{ settings.sources.length }} configured sources</CardDescription>
      </CardHeader>
      <CardContent>
        <ul class="space-y-2">
          <li
            v-for="source in settings.sources"
            :key="source.filename"
            class="flex items-center justify-between p-2 bg-muted rounded-md"
          >
            <span class="font-mono text-sm">{{ source.endpoint.split('.').pop() }}</span>
            <Badge variant="outline">{{ source.search_type }}</Badge>
          </li>
        </ul>
      </CardContent>
    </Card>
  </div>
</template>
