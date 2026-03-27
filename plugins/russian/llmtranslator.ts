import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { fetchApi } from '@libs/fetch';
import { NovelStatus } from '@libs/novelStatus';
import { storage } from '@libs/storage';

interface Book {
  id: string;
  title: string;
  original_title?: string;
  author?: string;
  source_lang: string;
  cover_url?: string;
}

interface Chapter {
  id: string;
  ordinal: number;
  title?: string;
  raw_text?: string;
}

interface Branch {
  id: string;
  name: string;
  target_lang: string;
  translated_count?: number;
}

interface TranslationChunk {
  text: string;
}

interface ReaderResponse {
  chapter: Chapter;
  translation?: {
    translated_title?: string;
    translated_chunks: TranslationChunk[];
  };
}

class LLMTranslatorPlugin implements Plugin.PluginBase {
  id = 'llm-translator';
  name = 'LLM Translator';
  icon = 'src/ru/llmtranslator/icon.png';
  site = 'https://novels.forsen.fun';
  version = '1.0.0';

  pluginSettings = {
    authToken: {
      value: '',
      label: 'Auth Token',
      type: 'Text' as const,
    },
  };

  private headers() {
    const h: Record<string, string> = {};
    const token = storage.get('authToken');
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  private api(path: string) {
    return this.site + '/api' + path;
  }

  private textToHtml(text: string): string {
    return text
      .split('\n')
      .filter(l => l.trim())
      .map(l => '<p>' + l + '</p>')
      .join('');
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    const res = await fetchApi(this.api('/books'), {
      headers: this.headers(),
    });
    const books: Book[] = await res.json();
    return (books || []).map(b => ({
      name: b.title,
      path: 'books/' + b.id,
      cover: b.cover_url || defaultCover,
    }));
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const res = await fetchApi(this.api('/books'), {
      headers: this.headers(),
    });
    const books: Book[] = await res.json();
    const q = searchTerm.toLowerCase();
    return (books || [])
      .filter(
        b =>
          b.title.toLowerCase().includes(q) ||
          (b.original_title || '').toLowerCase().includes(q) ||
          (b.author || '').toLowerCase().includes(q),
      )
      .map(b => ({
        name: b.title,
        path: 'books/' + b.id,
        cover: b.cover_url || defaultCover,
      }));
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const bookId = novelPath.replace('books/', '');
    const h = this.headers();

    const [bookRes, branchesRes, chaptersRes] = await Promise.all([
      fetchApi(this.api('/books/' + bookId), { headers: h }),
      fetchApi(this.api('/books/' + bookId + '/branches'), { headers: h }),
      fetchApi(this.api('/books/' + bookId + '/chapters'), { headers: h }),
    ]);

    const book: Book = await bookRes.json();
    const branches: Branch[] = (await branchesRes.json()) || [];
    const chapters: Chapter[] = (await chaptersRes.json()) || [];

    const branch = branches[0];

    const chapterItems: Plugin.ChapterItem[] = chapters.map(ch => ({
      name: ch.title || 'Chapter ' + ch.ordinal,
      path: branch
        ? 'reader/' + branch.id + '/' + ch.ordinal
        : 'raw/' + bookId + '/' + ch.ordinal,
      chapterNumber: ch.ordinal,
    }));

    return {
      name: book.title,
      path: novelPath,
      cover: book.cover_url || defaultCover,
      author: book.author || '',
      summary: book.original_title
        ? 'Original: ' + book.original_title
        : '',
      status: NovelStatus.Unknown,
      genres: [book.source_lang]
        .concat(branch ? [branch.target_lang] : [])
        .join(','),
      chapters: chapterItems,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const parts = chapterPath.split('/');
    const h = this.headers();

    if (parts[0] === 'raw') {
      const bookId = parts[1];
      const ordinal = parts[2];
      const res = await fetchApi(
        this.api('/books/' + bookId + '/chapters'),
        { headers: h },
      );
      const chapters: Chapter[] = (await res.json()) || [];
      const ch = chapters.find(c => String(c.ordinal) === ordinal);
      if (!ch) return '<p>Chapter not found</p>';
      const fullRes = await fetchApi(this.api('/chapters/' + ch.id), {
        headers: h,
      });
      const full: Chapter = await fullRes.json();
      return this.textToHtml(full.raw_text || 'No content');
    }

    const branchId = parts[1];
    const ord = parts[2];
    const res = await fetchApi(
      this.api('/reader/' + branchId + '?ordinal=' + ord),
      { headers: h },
    );
    const data: ReaderResponse = await res.json();

    if (data.translation?.translated_chunks?.length) {
      const text = data.translation.translated_chunks
        .map(c => c.text)
        .join('');
      return this.textToHtml(text);
    }

    if (data.chapter?.raw_text) {
      return this.textToHtml(data.chapter.raw_text);
    }

    return '<p>Not translated yet</p>';
  }

  resolveUrl(path: string): string {
    return this.site + '/' + path;
  }
}

export default new LLMTranslatorPlugin();
