/* Catálogo de tecnologías: selección visual, detección en repos y comandos sugeridos. */

export const STACK_CATEGORIES = {
  lang: 'Lenguajes',
  frontend: 'Frontend',
  backend: 'Backend',
  mobile: 'Mobile',
  db: 'Bases de datos',
  orm: 'ORM / datos',
  ui: 'Estilos / UI',
  test: 'Testing',
  tooling: 'Herramientas',
  infra: 'Infra / deploy',
  services: 'Servicios / IA',
  other: 'Otros',
} as const;
export type StackCategory = keyof typeof STACK_CATEGORIES;

export interface StackItem {
  id: string;
  label: string;
  category: StackCategory;
  version?: string;
}

type Cmds = Partial<Record<'dev' | 'build' | 'test' | 'lint', string>>;

export interface Tech {
  id: string;
  label: string;
  cat: StackCategory;
  aliases?: string[];
  /** Dependencias (package.json, requirements, go.mod, etc.) que delatan la tecnología. */
  deps?: string[];
  /** Archivos en la raíz; "*.ext" compara por extensión. */
  files?: string[];
  /** Placeholders: {run} npm run/pnpm/yarn/bun run · {x} npx/pnpm dlx/… · {py} uv run/poetry run. */
  cmds?: Cmds;
}

const JS_APP: Cmds = { dev: '{run} dev', build: '{run} build' };

export const CATALOG: Tech[] = [
  // Lenguajes
  { id: 'typescript', label: 'TypeScript', cat: 'lang', aliases: ['ts'], deps: ['typescript'], files: ['tsconfig.json'] },
  { id: 'javascript', label: 'JavaScript', cat: 'lang', aliases: ['js', 'node', 'node.js', 'nodejs'], files: ['package.json'] },
  { id: 'python', label: 'Python', cat: 'lang', aliases: ['py'], files: ['pyproject.toml', 'requirements.txt', 'setup.py'] },
  { id: 'go', label: 'Go', cat: 'lang', aliases: ['golang'], files: ['go.mod'],
    cmds: { dev: 'go run .', build: 'go build ./...', test: 'go test ./...', lint: 'go vet ./...' } },
  { id: 'rust', label: 'Rust', cat: 'lang', files: ['Cargo.toml'],
    cmds: { dev: 'cargo run', build: 'cargo build --release', test: 'cargo test', lint: 'cargo clippy -- -D warnings' } },
  { id: 'java', label: 'Java', cat: 'lang', files: ['pom.xml', 'build.gradle'] },
  { id: 'kotlin', label: 'Kotlin', cat: 'lang', files: ['build.gradle.kts'] },
  { id: 'csharp', label: 'C# / .NET', cat: 'lang', aliases: ['c#', '.net', 'dotnet', 'csharp'], files: ['*.csproj', '*.sln'],
    cmds: { dev: 'dotnet run', build: 'dotnet build', test: 'dotnet test', lint: 'dotnet format --verify-no-changes' } },
  { id: 'php', label: 'PHP', cat: 'lang', files: ['composer.json'] },
  { id: 'ruby', label: 'Ruby', cat: 'lang', files: ['Gemfile'] },
  { id: 'dart', label: 'Dart', cat: 'lang', files: ['pubspec.yaml'] },
  { id: 'swift', label: 'Swift', cat: 'lang', files: ['Package.swift'] },

  // Frontend
  { id: 'react', label: 'React', cat: 'frontend', deps: ['react'] },
  { id: 'nextjs', label: 'Next.js', cat: 'frontend', aliases: ['next'], deps: ['next'], cmds: JS_APP },
  { id: 'vue', label: 'Vue', cat: 'frontend', aliases: ['vue.js', 'vuejs'], deps: ['vue'] },
  { id: 'nuxt', label: 'Nuxt', cat: 'frontend', deps: ['nuxt'], cmds: JS_APP },
  { id: 'svelte', label: 'Svelte', cat: 'frontend', deps: ['svelte'] },
  { id: 'sveltekit', label: 'SvelteKit', cat: 'frontend', deps: ['@sveltejs/kit'], cmds: JS_APP },
  { id: 'angular', label: 'Angular', cat: 'frontend', deps: ['@angular/core'], files: ['angular.json'],
    cmds: { dev: '{run} start', build: '{run} build', test: '{run} test' } },
  { id: 'astro', label: 'Astro', cat: 'frontend', deps: ['astro'], cmds: JS_APP },
  { id: 'remix', label: 'React Router / Remix', cat: 'frontend', aliases: ['remix', 'react router'], deps: ['@remix-run/react', '@react-router/dev'], cmds: JS_APP },
  { id: 'solid', label: 'SolidJS', cat: 'frontend', aliases: ['solid'], deps: ['solid-js'] },
  { id: 'vite', label: 'Vite', cat: 'frontend', deps: ['vite'], cmds: JS_APP },
  { id: 'tanstack-query', label: 'TanStack Query', cat: 'frontend', aliases: ['react query'], deps: ['@tanstack/react-query'] },
  { id: 'redux', label: 'Redux Toolkit', cat: 'frontend', aliases: ['redux'], deps: ['@reduxjs/toolkit'] },
  { id: 'zustand', label: 'Zustand', cat: 'frontend', deps: ['zustand'] },
  { id: 'htmx', label: 'htmx', cat: 'frontend', deps: ['htmx.org'] },

  // Backend
  { id: 'express', label: 'Express', cat: 'backend', deps: ['express'], cmds: { dev: '{run} dev' } },
  { id: 'fastify', label: 'Fastify', cat: 'backend', deps: ['fastify'], cmds: { dev: '{run} dev' } },
  { id: 'nestjs', label: 'NestJS', cat: 'backend', aliases: ['nest'], deps: ['@nestjs/core'], cmds: { dev: '{run} start:dev', build: '{run} build' } },
  { id: 'hono', label: 'Hono', cat: 'backend', deps: ['hono'], cmds: { dev: '{run} dev' } },
  { id: 'django', label: 'Django', cat: 'backend', deps: ['django'], files: ['manage.py'],
    cmds: { dev: '{py}python manage.py runserver', test: '{py}python manage.py test' } },
  { id: 'fastapi', label: 'FastAPI', cat: 'backend', deps: ['fastapi'], cmds: { dev: '{py}fastapi dev' } },
  { id: 'flask', label: 'Flask', cat: 'backend', deps: ['flask'], cmds: { dev: '{py}flask run --debug' } },
  { id: 'laravel', label: 'Laravel', cat: 'backend', deps: ['laravel/framework'], files: ['artisan'],
    cmds: { dev: 'php artisan serve', test: 'php artisan test', lint: './vendor/bin/pint --test' } },
  { id: 'symfony', label: 'Symfony', cat: 'backend', deps: ['symfony/framework-bundle'], cmds: { dev: 'symfony serve', test: './bin/phpunit' } },
  { id: 'rails', label: 'Ruby on Rails', cat: 'backend', aliases: ['rails', 'ror'], deps: ['rails'],
    cmds: { dev: 'bin/rails server', test: 'bin/rails test', lint: 'bundle exec rubocop' } },
  { id: 'spring', label: 'Spring Boot', cat: 'backend', aliases: ['spring'], deps: ['spring-boot'] },
  { id: 'aspnet', label: 'ASP.NET Core', cat: 'backend', aliases: ['asp.net'], deps: ['microsoft.aspnetcore'] },
  { id: 'gin', label: 'Gin', cat: 'backend', deps: ['github.com/gin-gonic/gin'] },
  { id: 'echo', label: 'Echo', cat: 'backend', deps: ['github.com/labstack/echo'] },
  { id: 'fiber', label: 'Fiber', cat: 'backend', deps: ['github.com/gofiber/fiber'] },
  { id: 'axum', label: 'Axum', cat: 'backend', deps: ['axum'] },
  { id: 'actix', label: 'Actix Web', cat: 'backend', aliases: ['actix'], deps: ['actix-web'] },

  // Mobile
  { id: 'react-native', label: 'React Native', cat: 'mobile', deps: ['react-native'], cmds: { dev: '{run} start' } },
  { id: 'expo', label: 'Expo', cat: 'mobile', deps: ['expo'], cmds: { dev: '{x} expo start' } },
  { id: 'flutter', label: 'Flutter', cat: 'mobile', deps: ['flutter'],
    cmds: { dev: 'flutter run', build: 'flutter build apk', test: 'flutter test', lint: 'flutter analyze' } },
  { id: 'swiftui', label: 'SwiftUI', cat: 'mobile' },
  { id: 'jetpack-compose', label: 'Jetpack Compose', cat: 'mobile', deps: ['androidx.compose'] },
  { id: 'capacitor', label: 'Capacitor / Ionic', cat: 'mobile', aliases: ['ionic', 'capacitor'], deps: ['@capacitor/core', '@ionic/core'] },

  // Bases de datos
  { id: 'postgresql', label: 'PostgreSQL', cat: 'db', aliases: ['postgres', 'pg'], deps: ['pg', 'postgres', 'psycopg', 'psycopg2', 'asyncpg', 'github.com/jackc/pgx'] },
  { id: 'mysql', label: 'MySQL', cat: 'db', aliases: ['mariadb'], deps: ['mysql2', 'mysqlclient', 'pymysql'] },
  { id: 'sqlite', label: 'SQLite', cat: 'db', deps: ['better-sqlite3', 'sqlite3', '@libsql/client'] },
  { id: 'mongodb', label: 'MongoDB', cat: 'db', aliases: ['mongo'], deps: ['mongodb', 'pymongo', 'motor'] },
  { id: 'redis', label: 'Redis', cat: 'db', deps: ['redis', 'ioredis'] },
  { id: 'supabase', label: 'Supabase', cat: 'db', deps: ['@supabase/supabase-js', 'supabase'] },
  { id: 'firebase', label: 'Firebase', cat: 'db', deps: ['firebase', 'firebase-admin'], files: ['firebase.json'] },

  // ORM / datos
  { id: 'prisma', label: 'Prisma', cat: 'orm', deps: ['prisma', '@prisma/client'] },
  { id: 'drizzle', label: 'Drizzle', cat: 'orm', deps: ['drizzle-orm'] },
  { id: 'typeorm', label: 'TypeORM', cat: 'orm', deps: ['typeorm'] },
  { id: 'sequelize', label: 'Sequelize', cat: 'orm', deps: ['sequelize'] },
  { id: 'mongoose', label: 'Mongoose', cat: 'orm', deps: ['mongoose'] },
  { id: 'sqlalchemy', label: 'SQLAlchemy', cat: 'orm', deps: ['sqlalchemy', 'sqlmodel'] },
  { id: 'pydantic', label: 'Pydantic', cat: 'orm', deps: ['pydantic'] },
  { id: 'gorm', label: 'GORM', cat: 'orm', deps: ['gorm.io/gorm'] },
  { id: 'efcore', label: 'Entity Framework Core', cat: 'orm', aliases: ['ef core'], deps: ['microsoft.entityframeworkcore'] },
  { id: 'graphql', label: 'GraphQL', cat: 'orm', deps: ['graphql', 'strawberry-graphql'] },
  { id: 'trpc', label: 'tRPC', cat: 'orm', deps: ['@trpc/server'] },
  { id: 'zod', label: 'Zod', cat: 'orm', deps: ['zod'] },

  // Estilos / UI
  { id: 'tailwind', label: 'Tailwind CSS', cat: 'ui', aliases: ['tailwind', 'tailwindcss'], deps: ['tailwindcss'] },
  { id: 'shadcn', label: 'shadcn/ui', cat: 'ui', aliases: ['shadcn'], files: ['components.json'] },
  { id: 'mui', label: 'Material UI', cat: 'ui', aliases: ['mui'], deps: ['@mui/material'] },
  { id: 'chakra', label: 'Chakra UI', cat: 'ui', deps: ['@chakra-ui/react'] },
  { id: 'bootstrap', label: 'Bootstrap', cat: 'ui', deps: ['bootstrap'] },
  { id: 'sass', label: 'Sass', cat: 'ui', aliases: ['scss'], deps: ['sass'] },
  { id: 'styled-components', label: 'styled-components', cat: 'ui', deps: ['styled-components'] },
  { id: 'storybook', label: 'Storybook', cat: 'ui', deps: ['storybook'], files: ['.storybook'] },

  // Testing
  { id: 'vitest', label: 'Vitest', cat: 'test', deps: ['vitest'], cmds: { test: '{run} test' } },
  { id: 'jest', label: 'Jest', cat: 'test', deps: ['jest'], cmds: { test: '{run} test' } },
  { id: 'testing-library', label: 'Testing Library', cat: 'test', deps: ['@testing-library/react', '@testing-library/vue'] },
  { id: 'playwright', label: 'Playwright', cat: 'test', deps: ['@playwright/test', 'playwright'] },
  { id: 'cypress', label: 'Cypress', cat: 'test', deps: ['cypress'] },
  { id: 'pytest', label: 'pytest', cat: 'test', deps: ['pytest'], cmds: { test: '{py}pytest' } },
  { id: 'phpunit', label: 'PHPUnit', cat: 'test', deps: ['phpunit/phpunit'] },
  { id: 'rspec', label: 'RSpec', cat: 'test', deps: ['rspec', 'rspec-rails'], cmds: { test: 'bundle exec rspec' } },

  // Herramientas
  { id: 'npm', label: 'npm', cat: 'tooling', files: ['package-lock.json'] },
  { id: 'pnpm', label: 'pnpm', cat: 'tooling', files: ['pnpm-lock.yaml', 'pnpm-workspace.yaml'] },
  { id: 'yarn', label: 'Yarn', cat: 'tooling', files: ['yarn.lock'] },
  { id: 'bun', label: 'Bun', cat: 'tooling', files: ['bun.lockb', 'bun.lock'] },
  { id: 'turborepo', label: 'Turborepo', cat: 'tooling', aliases: ['turbo'], deps: ['turbo'], files: ['turbo.json'] },
  { id: 'nx', label: 'Nx', cat: 'tooling', deps: ['nx'], files: ['nx.json'] },
  { id: 'eslint', label: 'ESLint', cat: 'tooling', deps: ['eslint'], cmds: { lint: '{run} lint' } },
  { id: 'prettier', label: 'Prettier', cat: 'tooling', deps: ['prettier'] },
  { id: 'biome', label: 'Biome', cat: 'tooling', deps: ['@biomejs/biome'], files: ['biome.json'], cmds: { lint: '{x} biome check .' } },
  { id: 'uv', label: 'uv', cat: 'tooling', files: ['uv.lock'] },
  { id: 'poetry', label: 'Poetry', cat: 'tooling', files: ['poetry.lock'] },
  { id: 'ruff', label: 'Ruff', cat: 'tooling', deps: ['ruff'], files: ['ruff.toml'], cmds: { lint: '{py}ruff check .' } },
  { id: 'mypy', label: 'mypy', cat: 'tooling', deps: ['mypy'] },
  { id: 'maven', label: 'Maven', cat: 'tooling', files: ['pom.xml'],
    cmds: { dev: './mvnw spring-boot:run', build: './mvnw package', test: './mvnw test' } },
  { id: 'gradle', label: 'Gradle', cat: 'tooling', files: ['build.gradle', 'build.gradle.kts'],
    cmds: { dev: './gradlew bootRun', build: './gradlew build', test: './gradlew test' } },
  { id: 'composer', label: 'Composer', cat: 'tooling', files: ['composer.json'] },
  { id: 'golangci', label: 'golangci-lint', cat: 'tooling', files: ['.golangci.yml', '.golangci.yaml'], cmds: { lint: 'golangci-lint run' } },

  // Infra
  { id: 'docker', label: 'Docker', cat: 'infra', files: ['Dockerfile'] },
  { id: 'docker-compose', label: 'Docker Compose', cat: 'infra', files: ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'] },
  { id: 'kubernetes', label: 'Kubernetes', cat: 'infra', aliases: ['k8s'], files: ['k8s', 'helm'] },
  { id: 'terraform', label: 'Terraform', cat: 'infra', files: ['*.tf', 'terraform'] },
  { id: 'github-actions', label: 'GitHub Actions', cat: 'infra', files: ['.github'] },
  { id: 'vercel', label: 'Vercel', cat: 'infra', files: ['vercel.json'] },
  { id: 'netlify', label: 'Netlify', cat: 'infra', files: ['netlify.toml'] },
  { id: 'cloudflare', label: 'Cloudflare Workers', cat: 'infra', aliases: ['cloudflare'], deps: ['wrangler'], files: ['wrangler.toml', 'wrangler.jsonc'] },
  { id: 'aws', label: 'AWS', cat: 'infra', deps: ['aws-cdk-lib', 'boto3', '@aws-sdk/client-s3'] },
  { id: 'gcp', label: 'Google Cloud', cat: 'infra', aliases: ['gcp'], deps: ['@google-cloud/storage', 'google-cloud-storage'] },
  { id: 'fly', label: 'Fly.io', cat: 'infra', files: ['fly.toml'] },

  // Servicios / IA
  { id: 'stripe', label: 'Stripe', cat: 'services', deps: ['stripe'] },
  { id: 'authjs', label: 'Auth.js', cat: 'services', aliases: ['nextauth', 'next-auth'], deps: ['next-auth', '@auth/core'] },
  { id: 'clerk', label: 'Clerk', cat: 'services', deps: ['@clerk/nextjs', '@clerk/clerk-react'] },
  { id: 'anthropic', label: 'Claude API', cat: 'services', aliases: ['anthropic', 'claude'], deps: ['@anthropic-ai/sdk', 'anthropic'] },
  { id: 'openai', label: 'OpenAI API', cat: 'services', aliases: ['openai'], deps: ['openai'] },
  { id: 'gemini-api', label: 'Gemini API', cat: 'services', aliases: ['gemini'], deps: ['@google/genai', 'google-genai'] },
  { id: 'vercel-ai', label: 'Vercel AI SDK', cat: 'services', deps: ['ai'] },
  { id: 'langchain', label: 'LangChain', cat: 'services', deps: ['langchain', '@langchain/core'] },
];

export const TECH_BY_ID = new Map(CATALOG.map((t) => [t.id, t]));

export const toItem = (t: Tech, version?: string): StackItem => ({ id: t.id, label: t.label, category: t.cat, ...(version ? { version } : {}) });

const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, ' ').trim();

/** Busca una tecnología por nombre, id o alias. */
export function findTech(name: string): Tech | undefined {
  const n = norm(name);
  return CATALOG.find((t) => t.id === n || norm(t.label) === n || t.aliases?.some((a) => norm(a) === n));
}

export function searchTech(query: string): Tech[] {
  const q = norm(query);
  if (!q) return [];
  const score = (t: Tech) => {
    const names = [t.label, t.id, ...(t.aliases ?? [])].map(norm);
    if (names.some((x) => x === q)) return 0;
    if (names.some((x) => x.startsWith(q))) return 1;
    if (names.some((x) => x.includes(q))) return 2;
    return 9;
  };
  return CATALOG.map((t) => [t, score(t)] as const).filter(([, s]) => s < 9).sort((a, b) => a[1] - b[1]).map(([t]) => t).slice(0, 8);
}

/** Convierte texto libre ("Next.js 15, Prisma + PostgreSQL") en ítems del catálogo o personalizados. */
export function parseStack(text: string): StackItem[] {
  const out: StackItem[] = [];
  for (const raw of text.split(/[,;\n+·|]|\s\/\s|\by\b|\band\b/)) {
    const token = raw.replace(/\(.*?\)/g, '').trim();
    if (!token) continue;
    const m = token.match(/^(.*?)\s+v?(\d[\w.]*)$/);
    const [name, version] = m ? [m[1], m[2]] : [token, undefined];
    const byName = findTech(name);
    const byToken = byName ? undefined : findTech(token);
    const item: StackItem = byName
      ? toItem(byName, version)
      : byToken
        ? toItem(byToken)
        : { id: `custom-${norm(token)}`, label: token, category: 'other' };
    if (!out.some((x) => x.id === item.id)) out.push(item);
  }
  return out;
}

/** Texto compacto agrupado por categoría, para prompts y archivos generados. */
export function stackLines(items: StackItem[]): string[] {
  return (Object.keys(STACK_CATEGORIES) as StackCategory[])
    .map((cat) => {
      const list = items.filter((i) => i.category === cat).map((i) => (i.version ? `${i.label} ${i.version}` : i.label));
      return list.length ? `${STACK_CATEGORIES[cat]}: ${list.join(', ')}` : '';
    })
    .filter(Boolean);
}

/* ---------- comandos sugeridos ---------- */

const CAT_PRIORITY: Record<StackCategory, number> = {
  lang: 0, tooling: 1, db: 1, orm: 1, ui: 1, services: 1, infra: 1, other: 1, test: 2, frontend: 3, mobile: 3, backend: 4,
};

/** Deduce dev/build/test/lint a partir del stack. Los frameworks pisan a los lenguajes; el backend al frontend. */
export function suggestCommands(items: StackItem[]): Cmds {
  const has = (id: string) => items.some((i) => i.id === id);
  const pm = has('pnpm') ? 'pnpm' : has('yarn') ? 'yarn' : has('bun') ? 'bun' : 'npm';
  const run = { npm: 'npm run', pnpm: 'pnpm', yarn: 'yarn', bun: 'bun run' }[pm];
  const x = { npm: 'npx', pnpm: 'pnpm dlx', yarn: 'yarn dlx', bun: 'bunx' }[pm];
  const py = has('uv') ? 'uv run ' : has('poetry') ? 'poetry run ' : '';
  const out: Cmds = {};
  const techs = items
    .map((i) => TECH_BY_ID.get(i.id))
    .filter((t): t is Tech => !!t?.cmds)
    .sort((a, b) => CAT_PRIORITY[a.cat] - CAT_PRIORITY[b.cat]);
  const fill = (v: string) => v.replaceAll('{run}', run).replaceAll('{x}', x).replaceAll('{py}', py);
  for (const t of techs) for (const [k, v] of Object.entries(t.cmds!)) out[k as keyof Cmds] = fill(v);
  // Una herramienta de test o lint elegida explícitamente (pytest, RSpec, Ruff, ESLint…) manda sobre el framework.
  for (const t of techs.filter((t) => t.cat === 'test' || t.cat === 'tooling'))
    for (const k of ['test', 'lint'] as const) if (t.cmds![k]) out[k] = fill(t.cmds![k]!);
  return out;
}
