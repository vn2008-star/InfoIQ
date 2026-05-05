export interface Lead {
  id?: string;
  business_name: string;
  industry: string;
  address: string;
  city: string;
  state: string;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  google_maps_url: string | null;
  source: string;
  status: 'New' | 'Contacted' | 'Signed Up';
  created_at?: string;
}

export type SearchMode = 'quick' | 'deep' | 'fallback';

export type SearchRequest = {
  industry: string;
  city: string;
  state: string;
  country: string;
  mode: SearchMode;
  maxResults?: number;
};

export type SearchResponse = {
  leads: Lead[];
  sources: {
    name: string;
    status: 'success' | 'error' | 'skipped';
    count: number;
    error?: string;
  }[];
  totalBeforeDedup: number;
};
