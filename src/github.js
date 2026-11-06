import { PROJECT } from './config.js';

function githubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'WebRadio-Discord-Bot',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function githubFetch(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers: githubHeaders() });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

export function githubConfig() {
  return {
    owner: process.env.GITHUB_OWNER || 'YourEliteSystems',
    repo: process.env.GITHUB_REPO || 'WebRadio',
  };
}

export async function fetchLatestRelease() {
  const { owner, repo } = githubConfig();
  return githubFetch(`/repos/${owner}/${repo}/releases/latest`);
}

export async function fetchOpenIssues(limit = 10) {
  const { owner, repo } = githubConfig();
  return githubFetch(`/repos/${owner}/${repo}/issues?state=open&per_page=${Math.min(limit, 100)}&sort=updated&direction=desc`);
}

export async function fetchRepository() {
  const { owner, repo } = githubConfig();
  return githubFetch(`/repos/${owner}/${repo}`);
}

export async function fetchReleases(limit = 20) {
  const { owner, repo } = githubConfig();
  return githubFetch(`/repos/${owner}/${repo}/releases?per_page=${Math.min(limit, 100)}`);
}

export function projectLinks() {
  return {
    github: PROJECT.github,
    releases: `${PROJECT.github}/releases`,
    issues: `${PROJECT.github}/issues`,
    roadmap: `${PROJECT.github}/blob/main/ROADMAP.md`,
  };
}
