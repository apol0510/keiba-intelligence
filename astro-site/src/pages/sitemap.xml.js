import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function GET() {
  const baseUrl = 'https://keiba-intelligence.keiba.link';

  // 静的ページのURL
  const staticPages = [
    { url: '', priority: '1.0', changefreq: 'daily' },
    { url: '/pricing', priority: '0.9', changefreq: 'weekly' },
    { url: '/results', priority: '0.9', changefreq: 'daily' },
    { url: '/free-prediction', priority: '0.8', changefreq: 'daily' },
    { url: '/free-prediction-jra', priority: '0.8', changefreq: 'daily' },
    { url: '/login', priority: '0.5', changefreq: 'monthly' },
  ];

  let dynamicPages = [];

  try {
    // archiveResults.jsonから動的URLを生成
    const archivePath = join(process.cwd(), 'src', 'data', 'archiveResults.json');

    if (existsSync(archivePath)) {
      const fileContent = readFileSync(archivePath, 'utf-8');
      const archiveData = JSON.parse(fileContent);

      // 年・月・会場のセットを作成
      const years = new Set();
      const yearMonths = new Set();
      const venues = new Set();
      const dates = [];

      archiveData.forEach(entry => {
        const [year, month, day] = entry.date.split('-');

        years.add(year);
        yearMonths.add(`${year}/${month}`);
        venues.add(entry.venue);
        dates.push({ year, month, day, date: entry.date });
      });

      // 年別ページ
      years.forEach(year => {
        dynamicPages.push({
          url: `/archive/${year}`,
          priority: '0.8',
          changefreq: 'weekly',
        });
      });

      // 月別ページ
      yearMonths.forEach(yearMonth => {
        dynamicPages.push({
          url: `/archive/${yearMonth}`,
          priority: '0.8',
          changefreq: 'daily',
        });
      });

      // 日別ページ（最重要SEO）
      dates.forEach(({ year, month, day, date }) => {
        dynamicPages.push({
          url: `/results/${year}/${month}/${day}`,
          priority: '0.9',
          changefreq: 'weekly',
          lastmod: date,
        });
      });

      // 会場別ページ
      const venueMap = {
        '船橋': 'funabashi',
        '川崎': 'kawasaki',
        '大井': 'ooi',
        '浦和': 'urawa',
      };

      venues.forEach(venue => {
        const venueSlug = venueMap[venue];
        if (venueSlug) {
          dynamicPages.push({
            url: `/venues/${venueSlug}`,
            priority: '0.8',
            changefreq: 'daily',
          });
        }
      });
    }
  } catch (error) {
    console.error('Error generating dynamic sitemap URLs:', error);
  }

  // 全URLを結合
  const allPages = [...staticPages, ...dynamicPages];

  // sitemap.xmlを生成
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages.map(page => `  <url>
    <loc>${baseUrl}${page.url}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>${page.lastmod ? `
    <lastmod>${page.lastmod}</lastmod>` : ''}
  </url>`).join('\n')}
</urlset>`;

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
