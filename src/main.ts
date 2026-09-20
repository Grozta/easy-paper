import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl, TFile, TFolder, Menu, normalizePath, BasesView, QueryController, AbstractInputSuggest } from 'obsidian';

/* ============================================================
 * 类型定义
 * ============================================================ */

interface NumericColorRule {
	threshold: number;
	color: string;
}

interface EnumColorRule {
	value: string;
	color: string;
}

interface PaperManagerSettings {
	notesFolder: string;
	pdfFolder: string;
	unpaywallEmail: string;
	easyScholarKey: string;
	paperTag: string;
	sourceDoiMap: Record<string, string>;
	columnVisibility: Record<string, boolean>;
	sortBy: string;
	sortOrder: 'asc' | 'desc';
	numericColors: Record<string, NumericColorRule[]>;
	enumColors: Record<string, EnumColorRule[]>;
	columnWidths: Record<string, number>;
}

/* ============================================================
 * 默认配置
 * ============================================================ */

const COLUMN_DEFS: Array<{ key: string; label: string; required?: boolean }> = [
	{ key: 'name', label: '名称', required: true },
	{ key: 'authors', label: '作者' },
	{ key: 'year', label: '年份' },
	{ key: 'venue', label: '期刊/会议' },
	{ key: 'type', label: '类型' },
	{ key: 'doi', label: 'DOI' },
	{ key: 'cited_by', label: '引用数' },
	{ key: 'impact_factor', label: 'IF' },
	{ key: 'sci_quartile', label: 'JCR' },
	{ key: 'cas_quartile', label: '中科院' },
	{ key: 'pdf', label: 'PDF' },
];

const SORT_OPTIONS: Array<{ key: string; label: string }> = [
	{ key: 'ctime', label: '创建时间' },
	{ key: 'mtime', label: '修改时间' },
	{ key: 'name', label: '名称' },
	{ key: 'year', label: '年份' },
	{ key: 'cited_by', label: '引用数' },
	{ key: 'impact_factor', label: '影响因子' },
];

/** 表格视图默认列宽（像素）。name 列不设，自动占满剩余空间 */
const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
	authors: 100,
	year: 55,
	venue: 110,
	type: 90,
	doi: 130,
	cited_by: 60,
	impact_factor: 50,
	sci_quartile: 50,
	cas_quartile: 80,
	pdf: 44,
};

const DEFAULT_SETTINGS: PaperManagerSettings = {
	notesFolder: '论文',
	pdfFolder: '论文/pdfs',
	unpaywallEmail: 'test@example.com',
	easyScholarKey: '',
	paperTag: 'paper',
	sourceDoiMap: {},
	columnVisibility: {
		name: true, authors: true, year: true, venue: true, type: true,
		doi: true, cited_by: true, impact_factor: true, sci_quartile: true,
		cas_quartile: true, pdf: true,
	},
	sortBy: 'ctime',
	columnWidths: {},
	sortOrder: 'desc',
	numericColors: {
		cited_by: [
			{ threshold: 500, color: '#ef4444' },
			{ threshold: 200, color: '#3b82f6' },
			{ threshold: 100, color: '#22c55e' },
		],
		impact_factor: [
			{ threshold: 20, color: '#ef4444' },
			{ threshold: 10, color: '#3b82f6' },
			{ threshold: 5, color: '#22c55e' },
		],
	},
	enumColors: {
		sci_quartile: [
			{ value: 'Q1', color: '#ef4444' },
			{ value: 'Q2', color: '#3b82f6' },
			{ value: 'Q3', color: '#22c55e' },
			{ value: 'Q4', color: '' },
		],
		cas_quartile: [
			{ value: '1区', color: '#ef4444' },
			{ value: '2区', color: '#3b82f6' },
			{ value: '3区', color: '#22c55e' },
			{ value: '4区', color: '' },
		],
	},
};

interface PaperMetadata {
	doi: string;
	arxivId: string | null;
	title: string;
	authors: string[];
	year: number | null;
	journal: string | null;
	venueShort: string | null;
	publisher: string | null;
	type: string | null;
	citedByCount: number | null;
	pdfUrl: string | null;
	oaUrl: string | null;
	abstract: string | null;
	issn: string | null;
	impactFactor: number | null;
	sciQuartile: string | null;
	casQuartile: string | null;
}

const PLUGIN_FIELDS = [
	'doi', 'title', 'authors', 'year', 'journal', 'venue_short',
	'issn', 'publisher', 'type', 'cited_by', 'impact_factor', 'sci_quartile',
	'cas_quartile', 'oa_url', 'pdf_url', 'abstract', 'pdf'
];

const CONFERENCE_MAP: Record<string, string> = {
	'computer vision and pattern recognition': 'CVPR',
	'international conference on computer vision': 'ICCV',
	'european conference on computer vision': 'ECCV',
	'neural information processing systems': 'NeurIPS',
	'advances in neural information processing systems': 'NeurIPS',
	'international conference on machine learning': 'ICML',
	'international conference on learning representations': 'ICLR',
	'aaai conference on artificial intelligence': 'AAAI',
	'international joint conference on artificial intelligence': 'IJCAI',
	'association for computational linguistics': 'ACL',
	'empirical methods in natural language processing': 'EMNLP',
	'north american chapter of the association for computational linguistics': 'NAACL',
	'international conference on acoustics, speech and signal processing': 'ICASSP',
	'international conference on robotics and automation': 'ICRA',
	'knowledge discovery and data mining': 'KDD',
	'the web conference': 'WWW',
	'world wide web conference': 'WWW',
	'special interest group on data communication': 'SIGCOMM',
	'human factors in computing systems': 'CHI',
	'medical image computing and computer assisted intervention': 'MICCAI',
	'computer aided verification': 'CAV',
	'foundations of software engineering': 'FSE',
	'international conference on software engineering': 'ICSE',
	'symposium on operating systems principles': 'SOSP',
	'operating systems design and implementation': 'OSDI',
	'networked systems design and implementation': 'NSDI',
};

type RefreshResult = 'updated' | 'skipped' | 'failed';

/* ============================================================
 * 主插件
 * ============================================================ */

export default class PaperManagerPlugin extends Plugin {
	settings: PaperManagerSettings;
	private lastArxivRequest = 0;

	public currentExplorerPath = '';
	private viewListeners = new Set<() => void>();

	private lastFolderPath = '';
	private lastFolderTime = 0;
	private pendingToggle: { el: HTMLElement; timer: number } | null = null;
	private syntheticClick = false;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('file-plus', '从 DOI 创建论文笔记', () => {
			this.promptForDOI();
		});

		this.addCommand({
			id: 'create-paper-note-from-doi',
			name: '从 DOI 创建论文笔记',
			callback: () => this.promptForDOI()
		});

		this.addCommand({
			id: 'refresh-current-note',
			name: '刷新当前笔记的元数据',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (file && file.extension === 'md') {
					if (!checking) this.refreshNoteMetadata(file);
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'batch-refresh-all',
			name: '批量刷新所有论文元数据',
			callback: () => this.batchRefreshAll()
		});

		this.addCommand({
			id: 'add-paper-tag-to-all',
			name: '为论文文件夹下所有笔记添加标签',
			callback: () => this.addPaperTagToAll()
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file) => {
				if (file instanceof TFolder) {
					menu.addItem((item) => {
						item.setTitle('从 DOI 创建论文笔记')
							.setIcon('file-plus')
							.onClick(() => this.promptForDOI(file.path));
					});
				}
				if (file instanceof TFile && file.extension === 'md') {
					const cache = this.app.metadataCache.getFileCache(file);
					const doi = cache?.frontmatter?.doi;
					if (typeof doi === 'string' && doi.length > 0) {
						menu.addItem((item) => {
							item.setTitle('重新检索 DOI')
								.setIcon('refresh-cw')
								.onClick(() => this.refreshNoteMetadata(file));
						});
					}
				}
			})
		);

		this.registerDomEvent(document, 'click', (evt) => {
			this.handleFileTreeClick(evt);
		}, { capture: true });

		this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
			if (this.settings.sourceDoiMap[oldPath]) {
				this.settings.sourceDoiMap[file.path] = this.settings.sourceDoiMap[oldPath];
				delete this.settings.sourceDoiMap[oldPath];
				await this.saveSettings();
			}
		}));

		this.registerEvent(this.app.vault.on('delete', async (file) => {
			if (this.settings.sourceDoiMap[file.path]) {
				delete this.settings.sourceDoiMap[file.path];
				await this.saveSettings();
			}
		}));

		this.registerBasesView('paper-tree-view', {
			name: '论文树形视图',
			icon: 'lucide-folder-tree',
			factory: (controller: QueryController, containerEl: HTMLElement) =>
				new PaperTreeBasesView(controller, containerEl, this),
		});

		this.registerBasesView('paper-manager-view', {
			name: '论文表格视图',
			icon: 'lucide-table',
			factory: (controller: QueryController, containerEl: HTMLElement) =>
				new PaperTableBasesView(controller, containerEl, this),
		});

		await this.ensureBaseFile();
		this.addSettingTab(new PaperManagerSettingTab(this.app, this));
	}

	registerViewListener(fn: () => void): () => void {
		this.viewListeners.add(fn);
		return () => this.viewListeners.delete(fn);
	}

	notifyViews() {
		this.viewListeners.forEach(fn => {
			try { fn(); } catch (e) { console.error('[PaperManager] view listener error', e); }
		});
	}

	setExplorerPath(relPath: string) {
		if (this.currentExplorerPath === relPath) return;
		this.currentExplorerPath = relPath;
		this.notifyViews();
	}

	private handleFileTreeClick(evt: MouseEvent) {
		if (this.syntheticClick) return;

		const target = evt.target as Element | null;
		if (!target || typeof target.closest !== 'function') return;

		const navFolder = target.closest('.nav-folder-title') as HTMLElement | null;
		const navFile = target.closest('.nav-file-title') as HTMLElement | null;

		if (navFile && !navFolder) {
			const path = navFile.getAttribute('data-path');
			if (path) {
				const idx = path.lastIndexOf('/');
				const parentFolder = idx > 0 ? path.substring(0, idx) : '';
				this.switchViewByFolderPath(parentFolder);
			}
			return;
		}

		if (!navFolder) return;

		const path = navFolder.getAttribute('data-path');
		if (!path) return;

		evt.preventDefault();
		evt.stopPropagation();
		evt.stopImmediatePropagation();

		const now = Date.now();
		const isDouble = path === this.lastFolderPath && (now - this.lastFolderTime) < 400;

		if (isDouble) {
			if (this.pendingToggle) {
				clearTimeout(this.pendingToggle.timer);
				this.pendingToggle = null;
			}
			this.lastFolderPath = '';
			this.lastFolderTime = 0;
			this.switchViewByFolderPath(path);
			return;
		}

		if (this.pendingToggle) {
			clearTimeout(this.pendingToggle.timer);
			const prevEl = this.pendingToggle.el;
			this.pendingToggle = null;
			this.dispatchSyntheticClick(prevEl);
		}

		this.lastFolderPath = path;
		this.lastFolderTime = now;

		const el = navFolder;
		const timer = window.setTimeout(() => {
			this.pendingToggle = null;
			this.lastFolderPath = '';
			this.lastFolderTime = 0;
			this.dispatchSyntheticClick(el);
		}, 250);

		this.pendingToggle = { el, timer };
	}

	private dispatchSyntheticClick(el: HTMLElement) {
		this.syntheticClick = true;
		try {
			el.dispatchEvent(new MouseEvent('click', {
				bubbles: true,
				cancelable: true,
				view: window
			}));
		} finally {
			this.syntheticClick = false;
		}
	}

	private switchViewByFolderPath(targetFolder: string) {
		const rootPath = normalizePath(this.settings.notesFolder).replace(/\/+$/, '');
		const pdfPath = normalizePath(this.settings.pdfFolder).replace(/\/+$/, '');

		if (targetFolder !== rootPath && !targetFolder.startsWith(rootPath + '/')) return;
		if (pdfPath && (targetFolder === pdfPath || targetFolder.startsWith(pdfPath + '/'))) return;

		const relPath = targetFolder === rootPath ? '' : targetFolder.slice(rootPath.length + 1);
		this.setExplorerPath(relPath);
	}

	getDefaultFolder(): string {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			const parent = activeFile.parent;
			if (parent && parent.path !== '/' && parent.path !== '') return parent.path;
		}
		return this.settings.notesFolder;
	}

	validateTargetFolder(path: string): { valid: boolean; error?: string; normalized?: string } {
		if (!path || !path.trim()) return { valid: false, error: '存放位置不能为空' };
		if (/[\\:*?"<>|]/.test(path)) return { valid: false, error: '路径包含非法字符（\\ : * ? " < > |）' };
		const folder = normalizePath(path.trim()).replace(/\/+$/, '');
		const pdfFolder = normalizePath(this.settings.pdfFolder).replace(/\/+$/, '');
		if (folder === pdfFolder || folder.startsWith(pdfFolder + '/')) {
			return { valid: false, error: `不能选择 PDF 附件文件夹「${pdfFolder}」或其子目录` };
		}
		return { valid: true, normalized: folder };
	}

	promptForDOI(defaultFolder?: string) {
		new DOIInputModal(this.app, this, defaultFolder).open();
	}

	private normalizeDoi(doi: string): string {
		return doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase();
	}

	async refreshNoteMetadata(file: TFile, silent = false): Promise<RefreshResult> {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) { if (!silent) new Notice('该笔记没有 Frontmatter'); return 'failed'; }

		const currentDoiRaw = fm.doi;
		if (!currentDoiRaw || typeof currentDoiRaw !== 'string') {
			if (!silent) new Notice('该笔记没有 doi 字段，无法刷新');
			return 'failed';
		}
		const currentDoi = this.normalizeDoi(currentDoiRaw);
		const sourceDoi = this.settings.sourceDoiMap[file.path];

		if (sourceDoi && this.normalizeDoi(sourceDoi) === currentDoi) {
			if (!silent) new Notice(`元数据已是最新（来源：${sourceDoi}），无需刷新`);
			return 'skipped';
		}

		if (!silent) {
			if (sourceDoi) new Notice(`检测到 DOI 变更（${sourceDoi} → ${currentDoi}），正在刷新...`);
			else new Notice(`正在首次生成元数据（${currentDoi}）...`);
		}

		const meta = await this.fetchMetadata(currentDoi);
		if (!meta) {
			if (!silent) new Notice(`无法查询到 DOI：${currentDoi}，笔记未修改`);
			return 'failed';
		}

		const pdfPath = normalizePath(`${this.settings.pdfFolder}/${file.basename}.pdf`);
		const oldArxivId = typeof fm.arxiv_id === 'string' ? fm.arxiv_id : null;

		await this.writeMetadataToFile(file, meta, pdfPath, true, oldArxivId);
		if (!silent) new Notice('元数据已刷新');
		return 'updated';
	}

	async batchRefreshAll() {
		const folderPath = normalizePath(this.settings.notesFolder);
		const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folderPath + '/'));
		const targets = files.filter(f => {
			const cache = this.app.metadataCache.getFileCache(f);
			return typeof cache?.frontmatter?.doi === 'string' && cache.frontmatter.doi.length > 0;
		});

		if (targets.length === 0) {
			new Notice(`文件夹 ${folderPath} 下没有带 doi 字段的笔记`);
			return;
		}

		const modal = new ProgressModal(this.app, targets.length);
		modal.open();

		let updated = 0, skipped = 0, failed = 0;
		for (let i = 0; i < targets.length; i++) {
			const file = targets[i];
			modal.updateProgress(i + 1, file.basename, updated, skipped, failed);
			try {
				const result = await this.refreshNoteMetadata(file, true);
				if (result === 'updated') updated++;
				else if (result === 'skipped') skipped++;
				else failed++;
			} catch (e) {
				console.error(`刷新失败: ${file.path}`, e);
				failed++;
			}
			await new Promise(r => setTimeout(r, 300));
		}
		modal.complete(updated, skipped, failed);
	}

	private async writeMetadataToFile(
		file: TFile, meta: PaperMetadata, pdfPath: string,
		cleanPluginFields: boolean, oldArxivId?: string | null
	) {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			if (cleanPluginFields) {
				for (const key of PLUGIN_FIELDS) delete fm[key];
			}
			fm.doi = meta.doi;
			if (meta.arxivId) fm.arxiv_id = meta.arxivId;
			else if (oldArxivId) fm.arxiv_id = oldArxivId;
			if (!meta.arxivId && oldArxivId) fm.previous_doi = `10.48550/arXiv.${oldArxivId}`;

			fm.title = meta.title;
			fm.authors = meta.authors;
			if (meta.year !== null) fm.year = meta.year;
			if (meta.journal) fm.journal = meta.journal;
			if (meta.venueShort) fm.venue_short = meta.venueShort;
			if (meta.issn) fm.issn = meta.issn;
			if (meta.publisher) fm.publisher = meta.publisher;
			if (meta.type) fm.type = meta.type;
			if (meta.citedByCount !== null) fm.cited_by = meta.citedByCount;
			if (meta.impactFactor !== null) fm.impact_factor = meta.impactFactor;
			if (meta.sciQuartile) fm.sci_quartile = meta.sciQuartile;
			if (meta.casQuartile) fm.cas_quartile = meta.casQuartile;
			if (meta.oaUrl) fm.oa_url = meta.oaUrl;
			if (meta.pdfUrl) fm.pdf_url = meta.pdfUrl;
			if (meta.abstract) fm.abstract = meta.abstract;
			if (meta.pdfUrl || meta.oaUrl) fm.pdf = `[[${pdfPath}]]`;

			const existingTags = Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []);
			if (!existingTags.includes(this.settings.paperTag)) existingTags.push(this.settings.paperTag);
			fm.tags = existingTags;
		});

		this.settings.sourceDoiMap[file.path] = meta.doi;
		await this.saveSettings();
	}

	async addPaperTagToAll() {
		const folderPath = normalizePath(this.settings.notesFolder);
		const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folderPath + '/'));
		if (files.length === 0) { new Notice(`文件夹 ${folderPath} 下没有 Markdown 文件`); return; }

		const confirmed = await this.confirmDialog(
			`将为 ${folderPath} 下的 ${files.length} 个文件添加「${this.settings.paperTag}」标签，是否继续？`
		);
		if (!confirmed) return;

		let count = 0;
		for (const file of files) {
			let added = false;
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				const existing = Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []);
				if (!existing.includes(this.settings.paperTag)) {
					existing.push(this.settings.paperTag);
					fm.tags = existing;
					added = true;
				}
			});
			if (added) count++;
		}
		new Notice(`已为 ${count} 篇笔记添加 ${this.settings.paperTag} 标签`);
	}

	private getVenueShort(journalName: string | null): string | null {
		if (!journalName) return null;
		const parenMatch = journalName.match(/\(([A-Z][A-Z0-9\-]{1,15})\)/);
		if (parenMatch) return parenMatch[1];
		const lower = journalName.toLowerCase();
		for (const [key, abbr] of Object.entries(CONFERENCE_MAP)) {
			if (lower.includes(key)) return abbr;
		}
		return null;
	}

	async ensureBaseFile() {
		const basePath = normalizePath('paper-manager.base');
		const content = this.buildBaseContent();
		const existing = this.app.vault.getAbstractFileByPath(basePath);
		if (!(existing instanceof TFile)) {
			await this.app.vault.create(basePath, content);
			return;
		}
		const existingContent = await this.app.vault.read(existing);
		if (existingContent.includes('# Generated by Paper Manager')) {
			if (existingContent !== content) await this.app.vault.modify(existing, content);
		}
	}

	private buildBaseContent(): string {
		const folder = this.settings.notesFolder.replace(/\/+$/, '');
		const tag = this.settings.paperTag;
		return `# Generated by Paper Manager plugin. Do not edit manually.
# 如需自定义视图列/排序，请复制这个文件另存并使用。

filters:
  and:
    - file.inFolder("${folder}")
    - file.hasTag("${tag}")

views:
  - type: paper-tree-view
    name: 按文件夹
  - type: paper-manager-view
    name: 全部论文
    sort:
      - property: year
        direction: DESC
`;
	}

	async updateBaseFile() { await this.ensureBaseFile(); }

	async fetchMetadata(doi: string): Promise<PaperMetadata | null> {
		const cleanDoi = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
		const arxivMatch = cleanDoi.match(/^10\.48550\/arxiv\.(.+)$/i);
		if (arxivMatch) {
			const arxivMeta = await this.fetchArxivMetadata(arxivMatch[1]);
			if (arxivMeta) return arxivMeta;
		}

		const url = `https://api.openalex.org/works/doi:${cleanDoi}`;
		try {
			const response = await requestUrl({ url });
			const data = response.json;
			const authors: string[] = (data.authorships || [])
				.map((a: any) => a.author?.display_name).filter(Boolean);
			const source = data.primary_location?.source || {};
			let issn: string | null = null;
			if (source.issn_l) issn = source.issn_l;
			else if (Array.isArray(source.issn) && source.issn.length > 0) issn = source.issn[0];

			const journalName: string | null = source.display_name ?? null;
			const venueShort = this.getVenueShort(journalName);

			let pdfUrl: string | null = null;
			if (data.best_oa_location?.pdf_url) pdfUrl = data.best_oa_location.pdf_url;
			else if (Array.isArray(data.locations)) {
				for (const loc of data.locations) {
					if (loc?.pdf_url) { pdfUrl = loc.pdf_url; break; }
				}
			}
			if (!pdfUrl && data.primary_location?.pdf_url) pdfUrl = data.primary_location.pdf_url;

			let abstract: string | null = null;
			if (data.abstract_inverted_index) abstract = this.rebuildAbstract(data.abstract_inverted_index);
			const metrics = await this.fetchJournalMetricsFromEasyScholar(journalName);

			return {
				doi: cleanDoi, arxivId: null,
				title: data.title || 'Untitled', authors,
				year: data.publication_year ?? null,
				journal: journalName, venueShort,
				publisher: source.host_organization_name ?? null,
				type: data.type ?? null,
				citedByCount: data.cited_by_count ?? null,
				pdfUrl, oaUrl: data.open_access?.oa_url ?? null,
				abstract, issn,
				impactFactor: metrics.impactFactor,
				sciQuartile: metrics.sciQuartile,
				casQuartile: metrics.casQuartile
			};
		} catch (e: any) {
			console.error('OpenAlex 查询失败', e);
			return null;
		}
	}

	private async fetchJournalMetricsFromEasyScholar(journalName: string | null) {
		const empty = { impactFactor: null, sciQuartile: null, casQuartile: null };
		if (!this.settings.easyScholarKey || !journalName) return empty;
		try {
			const params = new URLSearchParams({ publicationName: journalName, secretKey: this.settings.easyScholarKey });
			const resp = await requestUrl({ url: `https://www.easyscholar.cc/open/getPublicationRank?${params.toString()}` });
			const data = resp.json;
			if (data && data.code === 200 && data.data) {
				const officialRank = data.data.officialRank?.all || {};
				const selectRank = data.data.officialRank?.select || {};
				return {
					impactFactor: officialRank.sciif ? parseFloat(officialRank.sciif) : null,
					sciQuartile: selectRank.sci || null,
					casQuartile: selectRank.sciBase || selectRank.sciUp || null
				};
			}
			return empty;
		} catch { return empty; }
	}

	private rebuildAbstract(invertedIndex: Record<string, number[]>): string {
		const positions: { word: string; pos: number }[] = [];
		for (const [word, poses] of Object.entries(invertedIndex)) {
			for (const pos of poses) positions.push({ word, pos });
		}
		positions.sort((a, b) => a.pos - b.pos);
		return positions.map(p => p.word).join(' ');
	}

	private async fetchArxivMetadata(arxivId: string): Promise<PaperMetadata | null> {
		const now = Date.now();
		const elapsed = now - this.lastArxivRequest;
		if (elapsed < 3000) await new Promise(r => setTimeout(r, 3000 - elapsed));
		this.lastArxivRequest = Date.now();

		try {
			const resp = await requestUrl({
				url: `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`,
				headers: { 'User-Agent': 'ObsidianPaperManager/1.0' }
			});
			const doc = new DOMParser().parseFromString(resp.text, 'application/xml');
			const entries = doc.querySelectorAll('entry');
			if (entries.length === 0) return null;
			const entry = entries[0];
			const title = (entry.querySelector('title')?.textContent || 'Untitled').replace(/\s+/g, ' ').trim();
			const authors: string[] = [];
			entry.querySelectorAll('author name').forEach(el => {
				const name = el.textContent?.trim();
				if (name) authors.push(name);
			});
			const publishedStr = entry.querySelector('published')?.textContent;
			const year = publishedStr ? new Date(publishedStr).getFullYear() : null;
			const abstract = (entry.querySelector('summary')?.textContent || '').replace(/\s+/g, ' ').trim() || null;
			const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
			const entryId = entry.querySelector('id')?.textContent || '';
			const idMatch = entryId.match(/abs\/(.+)$/);
			const normalizedId = idMatch ? idMatch[1] : arxivId;

			return {
				doi: `10.48550/arXiv.${arxivId}`, arxivId: normalizedId,
				title, authors, year,
				journal: 'arXiv', venueShort: null,
				publisher: 'arXiv', type: 'preprint',
				citedByCount: null, pdfUrl,
				oaUrl: `https://arxiv.org/abs/${arxivId}`,
				abstract, issn: null,
				impactFactor: null, sciQuartile: null, casQuartile: null
			};
		} catch (e) { console.error('arXiv 查询失败', e); return null; }
	}

	async createPaperNote(doi: string, targetFolder?: string) {
		new Notice(`正在查询 DOI: ${doi}...`);
		const meta = await this.fetchMetadata(doi);
		if (!meta) return;

		const safeTitle = meta.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
		const folderPath = normalizePath(targetFolder || this.settings.notesFolder);
		const filePath = normalizePath(`${folderPath}/${safeTitle}.md`);
		const pdfPath = normalizePath(`${this.settings.pdfFolder}/${safeTitle}.pdf`);

		if (!this.app.vault.getAbstractFileByPath(folderPath)) {
			try { await this.app.vault.createFolder(folderPath); }
			catch { new Notice(`无法创建文件夹：${folderPath}`); return; }
		}

		let file: TFile;
		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) {
			file = existing;
			new Notice(`笔记已存在，更新元数据: ${filePath}`);
		} else {
			const body = [
				`# ${meta.title}`, '', '## 摘要', '', meta.abstract || '', '',
				'## 我的笔记', '', '', '## 引用', '', ''
			].join('\n');
			file = await this.app.vault.create(filePath, body);
			new Notice(`已创建: ${filePath}`);
		}

		await this.writeMetadataToFile(file, meta, pdfPath, true, null);
		await this.app.workspace.getLeaf().openFile(file);
		await this.downloadPDF(meta, pdfPath);
	}

	private async getUnpaywallPdfUrl(doi: string): Promise<string | null> {
		try {
			const resp = await requestUrl({
				url: `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(this.settings.unpaywallEmail)}`
			});
			const data = resp.json;
			const best = data.best_oa_location;
			if (best?.url_for_pdf) return best.url_for_pdf;
			if (Array.isArray(data.oa_locations)) {
				for (const loc of data.oa_locations) {
					if (loc?.url_for_pdf) return loc.url_for_pdf;
				}
			}
			return null;
		} catch { return null; }
	}

	private buildPublisherPdfUrl(doi: string): string | null {
		const arxivMatch = doi.match(/^10\.48550\/arxiv\.(.+)$/i);
		if (arxivMatch) return `https://arxiv.org/pdf/${arxivMatch[1]}.pdf`;
		if (doi.startsWith('10.1371/')) {
			const match = doi.match(/^10\.1371\/journal\.(\w+)\./);
			const journalCode = match ? match[1] : 'pone';
			const path = journalCode === 'pone' ? 'plosone' : 'plos' + journalCode;
			return `https://journals.plos.org/${path}/article/file?id=${doi}&type=printable`;
		}
		return null;
	}

	async downloadPDF(meta: PaperMetadata, pdfPath: string) {
		const existingFile = this.app.vault.getAbstractFileByPath(pdfPath);
		if (existingFile instanceof TFile) {
			if (existingFile.stat.size > 1024) { new Notice('PDF 已存在且有效，跳过下载'); return; }
			await this.app.vault.delete(existingFile);
		}

		const folderPath = normalizePath(this.settings.pdfFolder);
		if (!this.app.vault.getAbstractFileByPath(folderPath)) {
			await this.app.vault.createFolder(folderPath).catch(() => {});
		}

		const candidates: string[] = [];
		if (meta.arxivId && meta.pdfUrl) candidates.push(meta.pdfUrl);
		else {
			const unpaywallUrl = await this.getUnpaywallPdfUrl(meta.doi);
			if (unpaywallUrl) candidates.push(unpaywallUrl);
		}
		if (meta.pdfUrl) candidates.push(meta.pdfUrl);
		if (meta.oaUrl) candidates.push(meta.oaUrl);
		const publisherUrl = this.buildPublisherPdfUrl(meta.doi);
		if (publisherUrl) candidates.push(publisherUrl);

		const unique = [...new Set(candidates)];
		if (unique.length === 0) { new Notice('该论文无开放获取 PDF 链接'); return; }

		new Notice('正在下载 PDF...');
		for (const url of unique) {
			if (await this.tryDownloadPdf(url, pdfPath)) return;
		}
		new Notice('无法自动下载 PDF。该论文可能需要订阅。');
	}

	private async tryDownloadPdf(url: string, pdfPath: string): Promise<boolean> {
		try {
			const headers: Record<string, string> = {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
				'Accept': 'application/pdf,*/*'
			};
			if (url.includes('journals.plos.org')) headers['Referer'] = 'https://journals.plos.org/';
			const resp = await requestUrl({ url, headers });
			if (resp.status < 200 || resp.status >= 300) return false;
			const buf = resp.arrayBuffer;
			if (!buf || buf.byteLength === 0) return false;
			const header = new Uint8Array(buf, 0, Math.min(5, buf.byteLength));
			if (!String.fromCharCode(...header).startsWith('%PDF')) return false;
			await this.app.vault.createBinary(pdfPath, buf);
			new Notice(`PDF 已下载: ${pdfPath} (${(buf.byteLength / 1024).toFixed(0)} KB)`);
			return true;
		} catch { return false; }
	}

	private confirmDialog(message: string): Promise<boolean> {
		return new Promise((resolve) => new ConfirmModal(this.app, message, resolve).open());
	}

	async loadSettings() {
		const loaded = await this.loadData() || {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

		if (!this.settings.sourceDoiMap || typeof this.settings.sourceDoiMap !== 'object') {
			this.settings.sourceDoiMap = {};
		}
		this.settings.columnVisibility = Object.assign({}, DEFAULT_SETTINGS.columnVisibility, loaded.columnVisibility || {});
		this.settings.numericColors = Object.assign({}, DEFAULT_SETTINGS.numericColors, loaded.numericColors || {});
		this.settings.enumColors = Object.assign({}, DEFAULT_SETTINGS.enumColors, loaded.enumColors || {});
		this.settings.columnWidths = Object.assign({}, loaded.columnWidths || {});
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

/* ============================================================
 * 树形视图
 * ============================================================ */

interface TreeNode {
	name: string;
	path: string;
	folders: Map<string, TreeNode>;
	files: any[];
}

export class PaperTreeBasesView extends BasesView {
	readonly type = 'paper-tree-view';
	private containerEl: HTMLElement;
	private plugin: PaperManagerPlugin;
	private collapsedFolders = new Set<string>();
	private unregister: () => void;

	constructor(controller: QueryController, parentEl: HTMLElement, plugin: PaperManagerPlugin) {
		super(controller);
		this.plugin = plugin;
		this.containerEl = parentEl.createDiv('pm-tree-container');
		this.unregister = plugin.registerViewListener(() => this.render());
	}

	onDataUpdated(): void { this.render(); }

	private render() {
		this.containerEl.empty();
		const entries = this.data.data;
		if (!entries || entries.length === 0) {
			this.containerEl.createEl('p', { text: '没有找到论文笔记。', cls: 'pm-tree-empty' });
			return;
		}
		const rootPath = normalizePath(this.plugin.settings.notesFolder).replace(/\/+$/, '');
		const tree = this.buildTree(entries, rootPath);
		this.renderTreeNode(tree, this.containerEl, 0);
	}

	private buildTree(entries: any[], rootPath: string): TreeNode {
		const root: TreeNode = { name: rootPath, path: rootPath, folders: new Map(), files: [] };
		for (const entry of entries) {
			const fullPath = entry.file.path;
			if (!fullPath.startsWith(rootPath + '/')) continue;
			const rel = fullPath.slice(rootPath.length + 1);
			const parts = rel.split('/');

			let current = root;
			for (let i = 0; i < parts.length - 1; i++) {
				const folderName = parts[i];
				if (!current.folders.has(folderName)) {
					current.folders.set(folderName, {
						name: folderName,
						path: current.path + '/' + folderName,
						folders: new Map(),
						files: []
					});
				}
				current = current.folders.get(folderName)!;
			}
			current.files.push(entry);
		}
		return root;
	}

	private countFiles(node: TreeNode): number {
		let count = node.files.length;
		for (const child of node.folders.values()) count += this.countFiles(child);
		return count;
	}

	private renderTreeNode(node: TreeNode, parentEl: HTMLElement, depth: number) {
		const sortedFolders = [...node.folders.values()].sort((a, b) =>
			a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true })
		);
		for (const folder of sortedFolders) this.renderFolder(folder, parentEl, depth);

		const sortedFiles = [...node.files].sort((a, b) => {
			const ya = Number(a.frontmatter?.year) || 0;
			const yb = Number(b.frontmatter?.year) || 0;
			return yb - ya;
		});
		for (const entry of sortedFiles) this.renderPaper(entry, parentEl, depth);
	}

	private renderFolder(folder: TreeNode, parentEl: HTMLElement, depth: number) {
		const isCollapsed = this.collapsedFolders.has(folder.path);
		const count = this.countFiles(folder);
		const wrapper = parentEl.createDiv({ cls: 'pm-tree-folder-wrapper' });
		const row = wrapper.createDiv({ cls: 'pm-tree-row pm-tree-folder-row' });

		row.createEl('span', { cls: 'pm-tree-arrow', text: isCollapsed ? '▶' : '▼' });
		const iconEl = row.createSpan({ cls: 'pm-tree-folder-icon' });
		iconEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
		row.createEl('span', { cls: 'pm-tree-folder-name', text: folder.name });
		row.createEl('span', { cls: 'pm-tree-folder-count', text: `${count}` });

		const childrenEl = wrapper.createDiv({ cls: 'pm-tree-children' });
		if (isCollapsed) childrenEl.addClass('pm-hidden');
		this.renderTreeNode(folder, childrenEl, depth + 1);

		row.onclick = () => {
			if (this.collapsedFolders.has(folder.path)) {
				this.collapsedFolders.delete(folder.path);
				childrenEl.removeClass('pm-hidden');
				row.querySelector('.pm-tree-arrow')!.textContent = '▼';
			} else {
				this.collapsedFolders.add(folder.path);
				childrenEl.addClass('pm-hidden');
				row.querySelector('.pm-tree-arrow')!.textContent = '▶';
			}
		};
	}

	private renderPaper(entry: any, parentEl: HTMLElement, depth: number) {
		const fm = entry.frontmatter;
		const row = parentEl.createDiv({ cls: 'pm-tree-row pm-tree-paper-row' });
		row.createEl('span', { cls: 'pm-tree-arrow pm-tree-arrow-placeholder' });

		const iconEl = row.createSpan({ cls: 'pm-tree-paper-icon' });
		iconEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;

		row.createEl('span', { cls: 'pm-tree-paper-title', text: fm.title || entry.file.basename });

		const metaParts: string[] = [];
		if (fm.year) metaParts.push(String(fm.year));
		const venue = fm.venue_short || fm.journal;
		if (venue) metaParts.push(String(venue));
		if (fm.cited_by !== undefined && fm.cited_by !== null) metaParts.push(`被引 ${fm.cited_by}`);
		if (fm.impact_factor !== undefined && fm.impact_factor !== null) metaParts.push(`IF ${fm.impact_factor}`);
		if (fm.sci_quartile) metaParts.push(String(fm.sci_quartile));

		if (metaParts.length > 0) {
			const metaEl = row.createEl('span', { cls: 'pm-tree-paper-meta', text: metaParts.join(' · ') });
			const fullMeta: string[] = [];
			if (fm.year) fullMeta.push(`年份：${fm.year}`);
			if (fm.journal) fullMeta.push(`期刊：${fm.journal}`);
			if (fm.publisher) fullMeta.push(`出版商：${fm.publisher}`);
			if (fm.cited_by !== undefined) fullMeta.push(`引用：${fm.cited_by}`);
			if (fm.impact_factor !== undefined) fullMeta.push(`影响因子：${fm.impact_factor}`);
			if (fm.sci_quartile) fullMeta.push(`JCR：${fm.sci_quartile}`);
			if (fm.cas_quartile) fullMeta.push(`中科院：${fm.cas_quartile}`);
			metaEl.setAttr('title', fullMeta.join('\n'));
		}

		if (fm.pdf) {
			const pdfEl = row.createSpan({ cls: 'pm-tree-paper-pdf' });
			pdfEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="9" y1="15" x2="15" y2="15"></line></svg>`;
			pdfEl.setAttr('title', '打开 PDF');
			pdfEl.onclick = (e) => {
				e.stopPropagation();
				const pdfPath = String(fm.pdf).replace(/^\[\[|\]\]$/g, '');
				this.plugin.app.workspace.openLinkText(pdfPath, '', false);
			};
		}

		row.onclick = () => this.plugin.app.workspace.getLeaf().openFile(entry.file);
	}
}

/* ============================================================
 * 表格视图
 * ============================================================ */

export class PaperTableBasesView extends BasesView {
	readonly type = 'paper-manager-view';
	private containerEl: HTMLElement;
	private plugin: PaperManagerPlugin;
	private unregister: () => void;

	constructor(controller: QueryController, parentEl: HTMLElement, plugin: PaperManagerPlugin) {
		super(controller);
		this.plugin = plugin;
		this.containerEl = parentEl.createDiv('pm-explorer-container');
		this.unregister = plugin.registerViewListener(() => this.render());
	}

	onDataUpdated(): void { this.render(); }

	private getVisibleColumns() {
		return COLUMN_DEFS.filter(col => col.required || this.plugin.settings.columnVisibility[col.key] !== false);
	}

	private render() {
		this.containerEl.empty();
		const entries = this.data.data;
		if (!entries || entries.length === 0) {
			this.containerEl.createEl('p', { text: '没有找到论文笔记。', cls: 'pm-tree-empty' });
			return;
		}

		const rootPath = normalizePath(this.plugin.settings.notesFolder).replace(/\/+$/, '');
		const currentPath = this.plugin.currentExplorerPath;
		const fullCurrentPath = currentPath ? rootPath + '/' + currentPath : rootPath;

		const subFolders = new Map<string, number>();
		const directNotes: any[] = [];

		for (const entry of entries) {
			const filePath = entry.file.path;
			if (!filePath.startsWith(fullCurrentPath + '/')) continue;
			const rel = filePath.slice(fullCurrentPath.length + 1);

			if (rel.includes('/')) {
				const folderName = rel.split('/')[0];
				subFolders.set(folderName, (subFolders.get(folderName) || 0) + 1);
			} else {
				directNotes.push(entry);
			}
		}

		if (subFolders.size === 0 && directNotes.length === 0) {
			this.containerEl.createEl('p', { text: '此文件夹下没有论文。', cls: 'pm-tree-empty' });
			return;
		}

		const visibleCols = this.getVisibleColumns();
		const table = this.containerEl.createEl('table', { cls: 'pm-table pm-explorer-table pm-resizable-table' });

		const colgroup = table.createEl('colgroup');
		for (const col of visibleCols) {
			const colEl = colgroup.createEl('col');
			if (col.key === 'name') continue;
			const width = this.plugin.settings.columnWidths[col.key] ?? DEFAULT_COLUMN_WIDTHS[col.key];
			if (width) colEl.setCssStyles({ width: `${width}px` });
		}

		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		visibleCols.forEach((col, idx) => {
			const th = headRow.createEl('th');

			if (col.key === 'name') {
				th.addClass('pm-name-header');

				if (currentPath !== '') {
					const backBtn = th.createEl('button', { cls: 'pm-back-btn' });
					backBtn.setAttr('aria-label', '返回上级目录');
					backBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>`;
					backBtn.onclick = (e) => {
						e.preventDefault();
						e.stopPropagation();
						const cur = this.plugin.currentExplorerPath;
						const i = cur.lastIndexOf('/');
						const parent = i > 0 ? cur.substring(0, i) : '';
						this.plugin.setExplorerPath(parent);
					};
				}

				th.createEl('span', { text: col.label });
			} else {
				th.setText(col.label);
			}

			if (idx < visibleCols.length - 1) {
				const handle = th.createEl('div', { cls: 'pm-col-resizer' });
				handle.setAttr('aria-label', `拖动调整「${col.label}」列宽`);
				this.attachResizeHandler(handle, col.key, table, colgroup);
			}
		});

		const tbody = table.createEl('tbody');

		const sortedFolders = [...subFolders.entries()].sort((a, b) =>
			a[0].localeCompare(b[0], 'zh-Hans-CN', { numeric: true })
		);
		for (const [folderName, count] of sortedFolders) {
			this.renderFolderRow(tbody, folderName, count, visibleCols.length);
		}

		const sortedNotes = this.sortEntries(directNotes);
		for (const entry of sortedNotes) {
			this.renderNoteRow(tbody, entry, visibleCols);
		}
	}

	private attachResizeHandler(
		handle: HTMLElement,
		colKey: string,
		table: HTMLTableElement,
		colgroup: HTMLTableColElement
	) {
		let startX = 0;
		let startWidth = 0;

		const getColIndex = () => this.getVisibleColumns().findIndex(c => c.key === colKey);

		const onMove = (e: MouseEvent) => {
			const idx = getColIndex();
			if (idx < 0) return;
			const delta = e.clientX - startX;
			const newWidth = Math.max(40, startWidth + delta);
			const colEl = colgroup.children[idx] as HTMLElement;
			if (colEl) colEl.setCssStyles({ width: `${newWidth}px` });
		};

		const onUp = async () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
			document.body.removeClass('pm-resizing');

			const idx = getColIndex();
			if (idx < 0) return;
			const ths = table.querySelectorAll('thead th');
			const th = ths[idx] as HTMLElement;
			if (th) {
				const w = Math.round(th.getBoundingClientRect().width);
				this.plugin.settings.columnWidths[colKey] = w;
				await this.plugin.saveSettings();
			}
		};

		handle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const idx = getColIndex();
			if (idx < 0) return;
			const ths = table.querySelectorAll('thead th');
			const th = ths[idx] as HTMLElement;
			if (!th) return;

			startX = e.clientX;
			startWidth = th.getBoundingClientRect().width;

			const colEl = colgroup.children[idx] as HTMLElement;
			if (colEl) colEl.setCssStyles({ width: `${startWidth}px` });

			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
			document.body.addClass('pm-resizing');
		});
	}

	private sortEntries(entries: any[]): any[] {
		const sortBy = this.plugin.settings.sortBy || 'ctime';
		const order = this.plugin.settings.sortOrder || 'desc';
		const mult = order === 'asc' ? 1 : -1;

		return [...entries].sort((a, b) => {
			let va: any, vb: any;

			if (sortBy === 'ctime') { va = a.file.stat.ctime; vb = b.file.stat.ctime; }
			else if (sortBy === 'mtime') { va = a.file.stat.mtime; vb = b.file.stat.mtime; }
			else if (sortBy === 'name') { va = a.file.basename; vb = b.file.basename; }
			else { va = a.frontmatter?.[sortBy]; vb = b.frontmatter?.[sortBy]; }

			if (va == null && vb == null) return 0;
			if (va == null) return 1 * mult;
			if (vb == null) return -1 * mult;

			const na = Number(va), nb = Number(vb);
			if (!isNaN(na) && !isNaN(nb)) return (na - nb) * mult;
			return String(va).localeCompare(String(vb), 'zh-Hans-CN') * mult;
		});
	}

	private renderFolderRow(tbody: HTMLElement, folderName: string, count: number, colCount: number) {
		const row = tbody.createEl('tr', { cls: 'pm-explorer-folder-row' });
		const nameCell = row.createEl('td');
		const nameWrap = nameCell.createDiv({ cls: 'pm-explorer-name-cell' });

		const iconWrap = nameWrap.createSpan({ cls: 'pm-explorer-folder-icon' });
		iconWrap.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;

		const nameEl = nameWrap.createEl('a', { text: folderName, cls: 'pm-explorer-folder-name' });
		const navigate = (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
			const cur = this.plugin.currentExplorerPath;
			this.plugin.setExplorerPath(cur ? cur + '/' + folderName : folderName);
		};
		nameEl.onclick = navigate;
		row.onclick = navigate;

		if (colCount > 1) {
			const countCell = row.createEl('td', { cls: 'pm-explorer-count-cell' });
			countCell.setAttr('colspan', String(colCount - 1));
			countCell.createSpan({ text: `${count} 篇论文`, cls: 'pm-explorer-folder-count' });
		}
	}

	private renderNoteRow(tbody: HTMLElement, entry: any, visibleCols: typeof COLUMN_DEFS) {
		const fm = entry.frontmatter;
		const row = tbody.createEl('tr', { cls: 'pm-explorer-note-row' });

		for (const col of visibleCols) {
			const cell = row.createEl('td');
			this.renderCell(cell, col.key, entry, fm);
		}
	}

	private renderCell(cell: HTMLElement, key: string, entry: any, fm: any) {
		switch (key) {
			case 'name': {
				const nameWrap = cell.createDiv({ cls: 'pm-explorer-name-cell' });
				const iconWrap = nameWrap.createSpan({ cls: 'pm-explorer-paper-icon' });
				iconWrap.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
				const titleEl = nameWrap.createEl('a', {
					text: fm.title || entry.file.basename,
					cls: 'pm-explorer-note-title'
				});
				titleEl.onclick = (e) => {
					e.preventDefault();
					this.plugin.app.workspace.getLeaf().openFile(entry.file);
				};
				return;
			}
			case 'authors': {
				const authors = fm.authors;
				const s = Array.isArray(authors)
					? (authors.length > 1 ? authors[0] + ' 等' : authors[0])
					: (authors || '—');
				cell.textContent = s;
				return;
			}
			case 'year': {
				cell.textContent = fm.year?.toString() || '—';
				return;
			}
			case 'venue': {
				cell.createEl('span', {
					text: fm.venue_short || fm.journal || '—',
					title: fm.journal || ''
				});
				return;
			}
			case 'type': {
				this.renderType(cell, fm.type);
				return;
			}
			case 'doi': {
				if (fm.doi) {
					const a = cell.createEl('a', { text: fm.doi, href: `https://doi.org/${fm.doi}` });
					a.setAttr('target', '_blank');
				} else cell.textContent = '—';
				return;
			}
			case 'cited_by': {
				this.renderNumericColored(cell, fm.cited_by, 'cited_by');
				return;
			}
			case 'impact_factor': {
				this.renderNumericColored(cell, fm.impact_factor, 'impact_factor');
				return;
			}
			case 'sci_quartile': {
				this.renderEnumColored(cell, fm.sci_quartile, 'sci_quartile');
				return;
			}
			case 'cas_quartile': {
				this.renderCasQuartile(cell, fm.cas_quartile);
				return;
			}
			case 'pdf': {
				if (fm.pdf) {
					const pdfLink = cell.createEl('a', { text: '📄', href: '#' });
					pdfLink.onclick = (e) => {
						e.preventDefault();
						const pdfPath = String(fm.pdf).replace(/^\[\[|\]\]$/g, '');
						this.plugin.app.workspace.openLinkText(pdfPath, '', false);
					};
				} else cell.textContent = '—';
				return;
			}
		}
	}

	private renderType(cell: HTMLElement, type: string | null) {
		if (!type) { cell.textContent = '—'; return; }
		const iconMap: Record<string, string> = {
			'article': '🔵', 'proceedings-article': '🟣', 'conference': '🟣',
			'preprint': '🟠', 'book': '📕', 'review': '🟢'
		};
		const icon = iconMap[type.toLowerCase()] || '⚪';
		cell.createEl('span', { text: `${type} ${icon}` });
	}

	private renderNumericColored(cell: HTMLElement, value: any, key: string) {
		if (value === null || value === undefined || isNaN(Number(value))) {
			cell.textContent = '—';
			return;
		}
		const num = Number(value);
		const rules = this.plugin.settings.numericColors[key] || [];
		const sorted = [...rules].sort((a, b) => b.threshold - a.threshold);

		for (const rule of sorted) {
			if (num >= rule.threshold && rule.color) {
				const span = cell.createEl('span', { text: `${num}` });
				span.setCssStyles({ color: rule.color, fontWeight: '600' });
				return;
			}
		}
		cell.textContent = `${num}`;
	}

	private renderEnumColored(cell: HTMLElement, value: any, key: string) {
		if (value === null || value === undefined || value === '') {
			cell.textContent = '—';
			return;
		}
		const v = String(value);
		const rules = this.plugin.settings.enumColors[key] || [];
		const found = rules.find(r => r.value === v);
		if (found && found.color) {
			const span = cell.createEl('span', { text: v });
			span.setCssStyles({ color: found.color, fontWeight: '600' });
		} else {
			cell.textContent = v;
		}
	}

	private renderCasQuartile(cell: HTMLElement, value: any) {
		if (value === null || value === undefined || value === '') {
			cell.textContent = '—';
			return;
		}
		const v = String(value);
		const match = v.match(/^(.*?)([1-4]区)\s*$/);
		let subject = '';
		let zone = v;
		if (match) {
			subject = match[1].trim();
			zone = match[2];
		}

		const rules = this.plugin.settings.enumColors['cas_quartile'] || [];
		const found = rules.find(r => r.value === zone);
		const color = found?.color || '';

		const wrap = cell.createDiv({ cls: 'pm-cas-cell' });
		if (subject) wrap.createDiv({ cls: 'pm-cas-subject', text: subject });
		const zoneEl = wrap.createDiv({ cls: 'pm-cas-zone', text: zone });
		if (color) {
			zoneEl.setCssStyles({ color: color, fontWeight: '600' });
		}
	}
}

/* ============================================================
 * 文件夹输入建议
 * ============================================================ */

class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(app: App, inputEl: HTMLInputElement) { super(app, inputEl); }

	getSuggestions(query: string): TFolder[] {
		const folders: TFolder[] = [];
		const walk = (folder: TFolder) => {
			folders.push(folder);
			for (const child of folder.children) if (child instanceof TFolder) walk(child);
		};
		walk(this.app.vault.getRoot());
		const lower = query.toLowerCase().trim();
		return folders.filter(f => f.path.toLowerCase().includes(lower))
			.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 30);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void { el.setText(folder.path || '/'); }
	selectSuggestion(folder: TFolder): void { this.setValue(folder.path); this.close(); }
}

/* ============================================================
 * 弹窗
 * ============================================================ */

class DOIInputModal extends Modal {
	private plugin: PaperManagerPlugin;
	private defaultFolderOverride?: string;

	constructor(app: App, plugin: PaperManagerPlugin, defaultFolder?: string) {
		super(app);
		this.plugin = plugin;
		this.defaultFolderOverride = defaultFolder;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: '从 DOI 创建论文笔记' });

		const doiLabel = contentEl.createEl('label', { text: 'DOI' });
		doiLabel.setCssStyles({
			display: 'block',
			marginBottom: '4px',
			fontWeight: '600',
		});
		const doiInput = contentEl.createEl('input', { type: 'text', placeholder: '例如: 10.1038/nature12373 或 10.48550/arXiv.1706.03762' });
		doiInput.setCssStyles({ width: '100%', marginBottom: '1em' });

		const pathLabel = contentEl.createEl('label', { text: '存放位置' });
		pathLabel.setCssStyles({
			display: 'block',
			marginBottom: '4px',
			fontWeight: '600',
		});
		const defaultPath = this.defaultFolderOverride || this.plugin.getDefaultFolder();
		const pathInput = contentEl.createEl('input', { type: 'text', value: defaultPath });
		pathInput.setCssStyles({ width: '100%', marginBottom: '4px' });
		new FolderSuggest(this.app, pathInput);

		const hint = contentEl.createEl('div');
		hint.setCssStyles({
			fontSize: '11px',
			color: 'var(--text-muted)',
			marginBottom: '1em',
		});
		hint.setText(`论文根目录：${this.plugin.settings.notesFolder}`);

		const btnRow = contentEl.createDiv();
		btnRow.setCssStyles({
			display: 'flex',
			justifyContent: 'flex-end',
			gap: '8px',
		});

		const cancelBtn = btnRow.createEl('button', { text: '取消' });
		cancelBtn.onclick = () => this.close();

		const submitBtn = btnRow.createEl('button', { text: '创建笔记' });
		submitBtn.addClass('mod-cta');
		submitBtn.onclick = () => this.submit(doiInput, pathInput);

		const enterSubmit = (e: KeyboardEvent) => {
			if (e.key === 'Enter') { e.preventDefault(); submitBtn.click(); }
		};
		doiInput.addEventListener('keydown', enterSubmit);
		pathInput.addEventListener('keydown', enterSubmit);
		doiInput.focus();
	}

	private submit(doiInput: HTMLInputElement, pathInput: HTMLInputElement) {
		const doi = doiInput.value.trim();
		const path = pathInput.value.trim();
		if (!doi) { new Notice('请输入 DOI'); return; }

		const validation = this.plugin.validateTargetFolder(path);
		if (!validation.valid || !validation.normalized) {
			new Notice(validation.error || '存放位置无效');
			return;
		}

		const folder = validation.normalized;
		const rootPath = normalizePath(this.plugin.settings.notesFolder).replace(/\/+$/, '');
		const inRoot = folder === rootPath || folder.startsWith(rootPath + '/');

		if (!inRoot) {
			new ConfirmModal(
				this.app,
				`选择的路径「${folder}」不在论文根目录「${rootPath}」下。\n\n笔记创建后不会出现在论文视图中。是否继续？`,
				(ok) => {
					if (ok) { this.close(); this.plugin.createPaperNote(doi, folder); }
				}
			).open();
			return;
		}

		this.close();
		this.plugin.createPaperNote(doi, folder);
	}

	onClose() { this.contentEl.empty(); }
}

class ProgressModal extends Modal {
	private total: number;
	private statusEl!: HTMLElement;
	private closeBtn!: HTMLButtonElement;

	constructor(app: App, total: number) { super(app); this.total = total; }

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: '批量刷新论文元数据' });
		this.statusEl = contentEl.createEl('p');
		this.statusEl.setCssStyles({
			whiteSpace: 'pre-wrap',
			fontFamily: 'var(--font-monospace)',
			fontSize: '13px',
		});
		this.statusEl.setText(`准备中...（共 ${this.total} 篇）`);

		const btnRow = contentEl.createDiv();
		btnRow.setCssStyles({
			display: 'flex',
			gap: '8px',
			justifyContent: 'flex-end',
			marginTop: '1em',
		});
		this.closeBtn = btnRow.createEl('button', { text: '关闭' });
		this.closeBtn.disabled = true;
		this.closeBtn.onclick = () => this.close();
	}

	updateProgress(current: number, filename: string, updated: number, skipped: number, failed: number) {
		this.statusEl.setText(
			`进度：${current} / ${this.total}\n更新：${updated}  跳过：${skipped}  失败：${failed}\n当前：${filename}`
		);
	}

	complete(updated: number, skipped: number, failed: number) {
		this.statusEl.setText(`✅ 完成！共 ${this.total} 篇\n更新：${updated}  跳过：${skipped}  失败：${failed}`);
		this.closeBtn.disabled = false;
	}

	onClose() { this.contentEl.empty(); }
}

class ConfirmModal extends Modal {
	private message: string;
	private callback: (result: boolean) => void;

	constructor(app: App, message: string, callback: (result: boolean) => void) {
		super(app);
		this.message = message;
		this.callback = callback;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: '确认操作' });
		const p = contentEl.createEl('p');
		p.setText(this.message);
		p.setCssStyles({ whiteSpace: 'pre-wrap' });

		const btnRow = contentEl.createDiv();
		btnRow.setCssStyles({
			display: 'flex',
			gap: '8px',
			justifyContent: 'flex-end',
			marginTop: '1em',
		});

		const cancelBtn = btnRow.createEl('button', { text: '取消' });
		cancelBtn.onclick = () => { this.callback(false); this.close(); };

		const okBtn = btnRow.createEl('button', { text: '确定' });
		okBtn.addClass('mod-cta');
		okBtn.onclick = () => { this.callback(true); this.close(); };
	}

	onClose() { this.contentEl.empty(); }
}

/* ============================================================
 * 设置面板
 * ============================================================ */

class PaperManagerSettingTab extends PluginSettingTab {
	plugin: PaperManagerPlugin;
	constructor(app: App, plugin: PaperManagerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Paper Manager 设置').setHeading();
		new Setting(containerEl).setName('目录设置').setHeading();

		new Setting(containerEl)
			.setName('论文根目录')
			.setDesc('论文笔记的根目录。创建笔记时默认放于此目录下；表格视图跟随左侧文件树，只在此目录内联动。')
			.addText(text => {
				text.setPlaceholder('论文').setValue(this.plugin.settings.notesFolder)
					.onChange(async (v) => {
						this.plugin.settings.notesFolder = v;
						await this.plugin.saveSettings();
						await this.plugin.updateBaseFile();
					});
				new FolderSuggest(this.app, text.inputEl);
			});

		new Setting(containerEl)
			.setName('PDF 文件夹')
			.setDesc('存放论文 PDF 的目录。创建笔记时不能选择此目录或其子目录；表格视图会跳过此目录。')
			.addText(text => {
				text.setPlaceholder('论文/pdfs').setValue(this.plugin.settings.pdfFolder)
					.onChange(async (v) => {
						this.plugin.settings.pdfFolder = v;
						await this.plugin.saveSettings();
					});
				new FolderSuggest(this.app, text.inputEl);
			});

		new Setting(containerEl).setName('论文标识').setHeading();

		new Setting(containerEl)
			.setName('论文标识符（标签）')
			.setDesc('创建笔记时自动添加的标签。')
			.addText(text => text
				.setPlaceholder('paper').setValue(this.plugin.settings.paperTag)
				.onChange(async (v) => {
					this.plugin.settings.paperTag = v;
					await this.plugin.saveSettings();
					await this.plugin.updateBaseFile();
				}));

		new Setting(containerEl)
			.setName('应用到现有笔记')
			.setDesc(`为论文根目录下的所有 Markdown 文件添加 ${this.plugin.settings.paperTag} 标签。`)
			.addButton(btn => btn.setButtonText('执行').onClick(async () => {
				await this.plugin.addPaperTagToAll();
			}));

		new Setting(containerEl).setName('表格视图 - 列显示').setHeading();
		new Setting(containerEl)
			.setName('说明')
			.setDesc('选择表格视图中要显示的列。"名称"列必须保留。');

		for (const col of COLUMN_DEFS) {
			new Setting(containerEl)
				.setName(col.label)
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.columnVisibility[col.key] !== false)
					.setDisabled(!!col.required)
					.onChange(async (value) => {
						this.plugin.settings.columnVisibility[col.key] = value;
						await this.plugin.saveSettings();
						this.plugin.notifyViews();
					}));
		}

		new Setting(containerEl).setName('表格视图 - 排序').setHeading();

		new Setting(containerEl)
			.setName('排序字段')
			.setDesc('默认按创建时间逆序排列。')
			.addDropdown(drop => {
				for (const opt of SORT_OPTIONS) drop.addOption(opt.key, opt.label);
				drop.setValue(this.plugin.settings.sortBy)
					.onChange(async (v) => {
						this.plugin.settings.sortBy = v;
						await this.plugin.saveSettings();
						this.plugin.notifyViews();
					});
			});

		new Setting(containerEl)
			.setName('排序方向')
			.addDropdown(drop => {
				drop.addOption('desc', '降序（大到小 / 新到旧）');
				drop.addOption('asc', '升序（小到大 / 旧到新）');
				drop.setValue(this.plugin.settings.sortOrder)
					.onChange(async (v) => {
						this.plugin.settings.sortOrder = v as 'asc' | 'desc';
						await this.plugin.saveSettings();
						this.plugin.notifyViews();
					});
			});

		new Setting(containerEl).setName('表格视图 - 颜色自定义').setHeading();
		new Setting(containerEl)
			.setName('说明')
			.setDesc('颜色仅作用于表格视图。颜色支持任何 CSS 颜色值（如 #ef4444 / red / #22c55e）。留空则使用默认字体颜色。规则按阈值从高到低匹配，第一个满足的生效。中科院分区只对 "X区" 部分着色。');

		this.renderNumericColorSection(containerEl, 'cited_by', '引用数颜色');
		this.renderNumericColorSection(containerEl, 'impact_factor', '影响因子颜色');
		this.renderEnumColorSection(containerEl, 'sci_quartile', 'JCR 分区颜色');
		this.renderEnumColorSection(containerEl, 'cas_quartile', '中科院分区颜色');

		new Setting(containerEl).setName('外部 API').setHeading();

		new Setting(containerEl)
			.setName('Unpaywall 邮箱')
			.setDesc('Unpaywall API 需要一个邮箱标识，任意合法邮箱即可。')
			.addText(text => text
				.setPlaceholder('test@example.com')
				.setValue(this.plugin.settings.unpaywallEmail)
				.onChange(async (v) => {
					this.plugin.settings.unpaywallEmail = v;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('EasyScholar Secret Key')
			.setDesc('在 https://www.easyscholar.cc/ 注册后获取。')
			.addText(text => text
				.setPlaceholder('输入你的 Secret Key')
				.setValue(this.plugin.settings.easyScholarKey)
				.onChange(async (v) => {
					this.plugin.settings.easyScholarKey = v;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl).setName('批量操作').setHeading();

		new Setting(containerEl)
			.setName('刷新所有论文元数据')
			.setDesc('遍历论文根目录下的所有笔记，仅刷新 DOI 发生变化的笔记。')
			.addButton(btn => btn.setButtonText('立即刷新').setCta().onClick(async () => {
				await this.plugin.batchRefreshAll();
			}));

		new Setting(containerEl).setName('内部数据').setHeading();

		const sourceCount = Object.keys(this.plugin.settings.sourceDoiMap || {}).length;
		new Setting(containerEl)
			.setName('已记录笔记数')
			.setDesc(`已记录 ${sourceCount} 篇笔记的元数据来源 DOI。`);

		new Setting(containerEl)
			.setName('清空元数据来源记录')
			.setDesc('清空后，下次批量刷新会重新为所有笔记建立记录（不会删除笔记本身）。')
			.addButton(btn => btn.setButtonText('清空').setWarning().onClick(async () => {
				const confirmed = await new Promise<boolean>((resolve) => {
					new ConfirmModal(this.app,
						`确定清空 ${sourceCount} 条元数据来源记录吗？`,
						resolve).open();
				});
				if (!confirmed) return;
				this.plugin.settings.sourceDoiMap = {};
				await this.plugin.saveSettings();
				this.display();
				new Notice('已清空来源记录');
			}));
	}

	private renderNumericColorSection(containerEl: HTMLElement, key: string, label: string) {
		const section = containerEl.createDiv({ cls: 'pm-color-section' });
		new Setting(section).setName(label).setHeading();

		const rules = this.plugin.settings.numericColors[key] || [];

		rules.forEach((rule, i) => {
			this.renderNumericRuleRow(section, key, i, rule);
		});

		const addBtn = section.createEl('button', { text: '+ 新增规则', cls: 'pm-rule-add' });
		addBtn.onclick = async () => {
			rules.push({ threshold: 0, color: '#ef4444' });
			this.plugin.settings.numericColors[key] = rules;
			await this.plugin.saveSettings();
			this.display();
			this.plugin.notifyViews();
		};

		if (rules.length === 0) {
			section.createEl('div', { text: '无规则（使用默认字体色）', cls: 'pm-rule-empty' });
		}
	}

	private renderNumericRuleRow(parentEl: HTMLElement, key: string, index: number, rule: NumericColorRule) {
		const row = parentEl.createDiv({ cls: 'pm-rule-row' });

		row.createEl('span', { text: '数值 ≥', cls: 'pm-rule-label' });

		const thresholdInput = row.createEl('input', {
			type: 'number', value: String(rule.threshold), cls: 'pm-rule-input'
		});
		thresholdInput.onchange = async () => {
			const n = Number(thresholdInput.value);
			if (!isNaN(n)) {
				rule.threshold = n;
				await this.plugin.saveSettings();
				this.plugin.notifyViews();
			}
		};

		row.createEl('span', { text: '时颜色', cls: 'pm-rule-label' });

		const colorInput = row.createEl('input', {
			type: 'text', value: rule.color, cls: 'pm-rule-input pm-rule-color-input'
		});
		colorInput.placeholder = '#ef4444 或留空';

		const preview = row.createSpan({ cls: 'pm-rule-preview' });
		preview.setCssStyles({
			background: rule.color || 'transparent',
			border: rule.color ? 'none' : '1px dashed var(--text-faint)',
		});

		colorInput.oninput = () => {
			rule.color = colorInput.value.trim();
			preview.setCssStyles({
				background: rule.color || 'transparent',
				border: rule.color ? 'none' : '1px dashed var(--text-faint)',
			});
		};
		colorInput.onchange = async () => {
			await this.plugin.saveSettings();
			this.plugin.notifyViews();
		};

		const delBtn = row.createEl('button', { text: '×', cls: 'pm-rule-del' });
		delBtn.title = '删除此规则';
		delBtn.onclick = async () => {
			const rules = this.plugin.settings.numericColors[key] || [];
			rules.splice(index, 1);
			this.plugin.settings.numericColors[key] = rules;
			await this.plugin.saveSettings();
			this.display();
			this.plugin.notifyViews();
		};
	}

	private renderEnumColorSection(containerEl: HTMLElement, key: string, label: string) {
		const section = containerEl.createDiv({ cls: 'pm-color-section' });
		new Setting(section).setName(label).setHeading();

		const rules = this.plugin.settings.enumColors[key] || [];

		rules.forEach((rule, i) => {
			this.renderEnumRuleRow(section, key, i, rule);
		});

		const addBtn = section.createEl('button', { text: '+ 新增映射', cls: 'pm-rule-add' });
		addBtn.onclick = async () => {
			rules.push({ value: '', color: '#ef4444' });
			this.plugin.settings.enumColors[key] = rules;
			await this.plugin.saveSettings();
			this.display();
			this.plugin.notifyViews();
		};
	}

	private renderEnumRuleRow(parentEl: HTMLElement, key: string, index: number, rule: EnumColorRule) {
		const row = parentEl.createDiv({ cls: 'pm-rule-row' });

		row.createEl('span', { text: '值', cls: 'pm-rule-label' });

		const valueInput = row.createEl('input', {
			type: 'text', value: rule.value, cls: 'pm-rule-input'
		});
		valueInput.placeholder = '如 Q1 / 1区';
		valueInput.onchange = async () => {
			rule.value = valueInput.value.trim();
			await this.plugin.saveSettings();
			this.plugin.notifyViews();
		};

		row.createEl('span', { text: '颜色', cls: 'pm-rule-label' });

		const colorInput = row.createEl('input', {
			type: 'text', value: rule.color, cls: 'pm-rule-input pm-rule-color-input'
		});
		colorInput.placeholder = '#ef4444 或留空';

		const preview = row.createSpan({ cls: 'pm-rule-preview' });
		preview.setCssStyles({
			background: rule.color || 'transparent',
			border: rule.color ? 'none' : '1px dashed var(--text-faint)',
		});

		colorInput.oninput = () => {
			rule.color = colorInput.value.trim();
			preview.setCssStyles({
				background: rule.color || 'transparent',
				border: rule.color ? 'none' : '1px dashed var(--text-faint)',
			});
		};
		colorInput.onchange = async () => {
			await this.plugin.saveSettings();
			this.plugin.notifyViews();
		};

		const delBtn = row.createEl('button', { text: '×', cls: 'pm-rule-del' });
		delBtn.title = '删除此映射';
		delBtn.onclick = async () => {
			const rules = this.plugin.settings.enumColors[key] || [];
			rules.splice(index, 1);
			this.plugin.settings.enumColors[key] = rules;
			await this.plugin.saveSettings();
			this.display();
			this.plugin.notifyViews();
		};
	}
}