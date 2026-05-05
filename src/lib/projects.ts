export interface Project {
  id: string;
  name: string;
  emoji: string;
  color: string;
  description: string;
  supabaseUrl: string;
  supabaseKey: string;
}

// Project registry — add new projects here + their env vars in .env.local
const projectDefinitions: Omit<Project, 'supabaseUrl' | 'supabaseKey'>[] = [
  {
    id: 'glowup',
    name: 'GlowUp',
    emoji: '💅',
    color: 'pink',
    description: 'Beauty & Salon SaaS',
  },
  // Future projects:
  // {
  //   id: 'kindara',
  //   name: 'Kindara',
  //   emoji: '🏠',
  //   color: 'sky',
  //   description: 'Homestay Management',
  // },
];

// Build full project objects with env vars
export function getProjects(): Project[] {
  return projectDefinitions
    .map((p) => ({
      ...p,
      supabaseUrl: process.env[`NEXT_PUBLIC_${p.id.toUpperCase()}_SUPABASE_URL`] || '',
      supabaseKey: process.env[`NEXT_PUBLIC_${p.id.toUpperCase()}_SUPABASE_ANON_KEY`] || '',
    }))
    .filter((p) => p.supabaseUrl && p.supabaseUrl.startsWith('http'));
}

// Client-safe project info (no keys)
export interface ProjectInfo {
  id: string;
  name: string;
  emoji: string;
  color: string;
  description: string;
  connected: boolean;
}

export function getProjectList(): ProjectInfo[] {
  return projectDefinitions.map((p) => {
    const url = process.env[`NEXT_PUBLIC_${p.id.toUpperCase()}_SUPABASE_URL`] || '';
    return {
      ...p,
      connected: !!url && url.startsWith('http'),
    };
  });
}

// CSV-only destination (no database)
export const CSV_ONLY_PROJECT: ProjectInfo = {
  id: 'csv_only',
  name: 'CSV Only',
  emoji: '📁',
  color: 'gray',
  description: 'Download only, no database',
  connected: true,
};
