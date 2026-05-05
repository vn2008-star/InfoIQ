import { NextResponse } from 'next/server';
import { getProjectList, CSV_ONLY_PROJECT } from '@/lib/projects';

export async function GET() {
  const projects = getProjectList();
  return NextResponse.json({
    projects: [...projects, CSV_ONLY_PROJECT],
  });
}
