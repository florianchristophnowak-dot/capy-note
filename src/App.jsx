import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { RUBRIC_TEMPLATES, rubricMax, cloneRubric } from './rubricTemplates';
import { FileUp, ChevronLeft, ChevronRight, Plus, Sun, Moon, Trash2, ZoomIn, ZoomOut, X, Check, Crop, Save, Eye, AlertTriangle, PenTool, Type, Undo2, Table, Edit3, SkipForward, Filter, Eraser, Circle, Download, FileText, Users, Award, BarChart3, CheckCircle2, Clock, Archive, Calendar, PartyPopper, Loader2, Move, AlignCenterVertical, Settings, RotateCw, Scissors, ArrowLeft, ArrowRight, ChevronDown } from 'lucide-react';

// ==================== App Version ====================
const APP_VERSION = '1.5.1';
const APP_AUTHOR = 'Florian Christoph Nowak';

// ==================== Capybara Logo Component ====================
function CapyLogo({ size = 48, className = '' }) {
  const s = size;
  // IMPORTANT (Electron + file://): never rely on a leading "/logo.png".
  // In a file:// build that would resolve to e.g. file:///C:/logo.png (wrong).
  // This URL() approach resolves relative to the currently loaded index.html
  // and works in both dev (http://localhost:5173) and build (file://.../dist).
  const logoSrc = new URL('logo.png', window.location.href).toString();
  return (
    <img
      src={logoSrc}
      width={s}
      height={s}
      alt="Capy-note"
      className={`select-none object-contain ${className}`}
      draggable={false}
    />
  );
}

// ==================== IndexedDB Storage ====================
const DB_NAME = 'capynote_db';
const DB_VERSION = 2;
const STORE_PROJECTS = 'projects';
const STORE_PDFS = 'pdfs';

const openDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
    if (!db.objectStoreNames.contains(STORE_PDFS)) db.createObjectStore(STORE_PDFS, { keyPath: 'id' });
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const dbPut = async (store, data) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const dbGet = async (store, key) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

const dbGetAll = async (store) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

const dbDelete = async (store, key) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

// ==================== Export/Import Helpers ====================
const arrayBufferToBase64 = (buffer) => {
  if (!buffer) return null;
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const base64ToArrayBuffer = (base64) => {
  if (!base64) return null;
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

const normalizeAnnotationRole = (a) => (a?.role ? a : { ...a, role: 'first' });

// ==================== Final-Logik ====================
// Auflösungsreihenfolge je Aufgabe: final → rot → grün.
// Damit gilt das Spec-Default „Final = Erstkorrekturwerte" automatisch,
// ohne dass irgendwo Werte kopiert werden müssen.
const getFinalTaskPoints = (student, task) => {
  const g = student?.grades?.[task.id] || {};
  if (g.finalPoints !== undefined) return g.finalPoints;
  if (g.points !== undefined) return g.points;       // Default: Erstkorrektur
  return g.secondPoints;                              // Fallback: nur grün vorhanden
};

const getFinalTotal = (student, tasks) => {
  if (student?.finalTotal !== undefined) return student.finalTotal;
  const raw = (tasks || []).reduce((sum, t) => sum + (getFinalTaskPoints(student, t) || 0), 0);
  return Math.min(getTasksMaxPoints(tasks), raw); // Bonus je Aufgabe möglich, Gesamt gedeckelt (1.5.2-Semantik)
};

const hasConflict = (g) =>
  !!g && g.points !== undefined && g.secondPoints !== undefined && g.points !== g.secondPoints;

// ==================== Migration: region -> regions[] ====================
// Eine Aufgabe kann mehrere Ausschnitte haben (auch auf verschiedenen Blattseiten).
// page/region bleiben als Legacy-Spiegel (= regions[0]) erhalten.
const migrateTaskRegions = (tasks) => (tasks || []).map(t =>
  (Array.isArray(t.regions) && t.regions.length) ? t
    : { ...t, regions: [{ id: 'r0', page: t.page || 1, rect: { ...(t.region || { x: 5, y: 5, width: 90, height: 30 }) } }] }
);

// Nach JEDER Änderung an regions aufrufen, damit page/region (= Ausschnitt 1) konsistent bleiben
const syncLegacyTaskFields = (t) => ({
  ...t,
  page: t.regions[0]?.page ?? t.page ?? 1,
  region: t.regions[0]?.rect ? { ...t.regions[0].rect } : t.region,
});

const taskRegionsOf = (t) =>
  (t?.regions?.length ? t.regions : [{ id: 'r0', page: t?.page || 1, rect: t?.region }]);

// Ausschnitt 1 behält den Schlüssel task.id (Altdaten brauchen keine Migration);
// weitere Ausschnitte: `${task.id}@@${region.id}`
const annKeyFor = (task, region, regionIndex) =>
  regionIndex === 0 ? task.id : `${task.id}@@${region.id}`;

const overrideKeyFor = (task, region) => `${task.id}::${region.id}`;

// Alle Annotations-Schlüssel einer Aufgabe (Basis + Komposit-Schlüssel)
const annKeysOfTask = (annotations, taskId) =>
  Object.keys(annotations || {}).filter(k => k === taskId || k.startsWith(`${taskId}@@`));

// ==================== Aufgaben-Expansion fürs Zeichnen ====================
// Jede Region wird zu einer „virtuellen Aufgabe" mit den Feldern, die
// drawStudentOverlay erwartet (id/page/region) – Overrides greifen im Export.
const expandTasksForStudent = (tasks, student) => (tasks || []).flatMap(t =>
  taskRegionsOf(t).map((r, ri) => ({
    ...t,
    baseId: t.id,
    id: annKeyFor(t, r, ri),
    page: r.page,
    region: (student?.regionOverrides?.[overrideKeyFor(t, r)]) || r.rect,
  }))
);

// ==================== Export-Helfer ====================
// Unicodefähig: „Aimée" und „François" bleiben in Dateinamen erhalten.
const sanitizeFileName = (name) => (name || '').replace(/[^\p{L}\p{N}_\- ]/gu, '').trim();

const downloadBytes = (bytes, filename) => {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const link = document.createElement('a');
  link.download = filename;
  link.href = URL.createObjectURL(blob);
  link.click();
  setTimeout(() => { try { URL.revokeObjectURL(link.href); } catch {} }, 5000);
};

const canvasToBytes = (canvas, type = 'image/png', quality) =>
  fetch(canvas.toDataURL(type, quality)).then(r => r.arrayBuffer());

// Raster-Fallback: Canvas als ganze Seite einbetten.
// Seitengröße = Canvas-Maße / Render-Scale 2 → KEIN A4-Zwang, keine Verzerrung.
const addRasterPage = async (outDoc, canvas) => {
  const img = await outDoc.embedJpg(await canvasToBytes(canvas, 'image/jpeg', 0.85));
  const page = outDoc.addPage([canvas.width / 2, canvas.height / 2]);
  page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  return page;
};

// ==================== Kompetenzbereiche (Schritt 11, optional) ====================
const COMPETENCES = [
  'Hörverstehen', 'Hör-/Sehverstehen', 'Leseverstehen',
  'Schreiben', 'Sprachmittlung', 'Sprechen', 'Verfügen über sprachliche Mittel',
];
const COMPETENCE_ABBR = {
  'Hörverstehen': 'HV', 'Hör-/Sehverstehen': 'HSV', 'Leseverstehen': 'LV',
  'Schreiben': 'S', 'Sprachmittlung': 'SM', 'Sprechen': 'Spr',
  'Verfügen über sprachliche Mittel': 'SpM',
};

// ==================== Krypto & Checksumme (Schritt 10) ====================
const sha256Hex = async (buf) => {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
};

const deriveKey = async (password, salt) => {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
};

// Containerformat: 'CAPYENC1' (8 B) | Salt (16 B) | IV (12 B) | AES-GCM-Ciphertext
const encryptBytes = async (bytes, password) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(8 + 16 + 12 + ct.length);
  out.set(new TextEncoder().encode('CAPYENC1'), 0);
  out.set(salt, 8); out.set(iv, 24); out.set(ct, 36);
  return out;
};

const decryptBytes = async (bytes, password) => {
  const salt = bytes.slice(8, 24), iv = bytes.slice(24, 36), ct = bytes.slice(36);
  const key = await deriveKey(password, salt);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
};

const isEncryptedContainer = (b) => b.length > 36 && strFromU8(b.slice(0, 8)) === 'CAPYENC1';
const isZipBytes = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b; // 'PK'

// ==================== Projekt-ZIP (.capyz, normative Struktur Spec 8) ====================
// Hinweis: gegenüber dem Spezifikationsentwurf um die 1.5.x-Felder erweitert
// (Zeichenliste, Namensfeld, Diagnose-Katalog und -Daten), damit das Projekt
// auf einem anderen Gerät wirklich identisch funktioniert.
const buildProjectZip = async (p /* vollständige Projektdaten inkl. pdfArrayBuffer */) => {
  const enc = (o) => strToU8(JSON.stringify(o, null, 2));

  const splitAnnotations = (role) => {
    const out = {};
    (p.students || []).forEach(s => {
      const perKey = {};
      Object.entries(s.annotations || {}).forEach(([k, arr]) => {
        const f = (arr || []).map(normalizeAnnotationRole).filter(a => (a?.role || 'first') === role);
        if (f.length) perKey[k] = f;
      });
      if (Object.keys(perKey).length) out[s.id] = perKey;
    });
    return out;
  };

  const files = {
    'project.json': enc({
      formatVersion: 1, app: 'capy-note', appVersion: APP_VERSION,
      id: p.id, title: p.title, createdAt: p.createdAt,
      subject: p.subject || '', level: p.level || '',
      correctionRole: p.correctionRole || 'first',
      allowSecondViewFirst: !!p.allowSecondViewFirst,
      isDemo: !!p.isDemo,
      pdfName: p.pdfName || '',
      pageCount: p.pageCount, pagesPerStudent: p.pagesPerStudent,
      studentCount: p.studentCount,
      deleteDate: p.deleteDate || null,
      progress: p.progress || 0, progressSecond: p.progressSecond || 0,
      resumeTask: p.resumeTask || 0, resumeStudent: p.resumeStudent || 0,
      modelSolutionOpacity: p.modelSolutionOpacity,
      sourceProjectId: p.sourceProjectId || null,
      correctionMarks: p.correctionMarks || null,
      nameField: p.nameField || null,
      diagnosticCatalog: p.diagnosticCatalog || [],
      sourcePdfSha256: p.pdfArrayBuffer ? await sha256Hex(p.pdfArrayBuffer) : (p.sourcePdfSha256 || null),
    }),
    'index/segmentation.json': enc((p.students || []).map(s => ({
      id: s.id, name: s.name || '', pageStart: s.pageStart, pages: s.pages || [],
    }))),
    'template/tasks.json': enc({
      tasks: p.tasks || [],
      scoreFields: p.scoreFields || {},
      taskPointPositions: p.taskPointPositions || {},
    }),
    'overrides/overrides.json': enc(Object.fromEntries(
      (p.students || [])
        .filter(s => s.regionOverrides && Object.keys(s.regionOverrides).length)
        .map(s => [s.id, s.regionOverrides])
    )),
    'grading/grades.json': enc({
      gradeTable: normalizeGradeTable(p.gradeTable),
      students: Object.fromEntries((p.students || []).map(s => [s.id, {
        grades: s.grades || {}, finalTotal: s.finalTotal, pending: s.pending || [],
        diagnostics: s.diagnostics || {},
      }])),
    }),
    'annotations/red.json': enc(splitAnnotations('first')),
    'annotations/green.json': enc(splitAnnotations('second')),
    'annotations/model.json': enc(p.modelSolutions || {}),
  };
  if (p.pdfArrayBuffer) files['source/class.pdf'] = new Uint8Array(p.pdfArrayBuffer.slice(0));

  return zipSync(files, { level: 6 });
};

const readProjectZip = async (bytes) => {
  const files = unzipSync(bytes);
  const json = (name, fallback) => {
    try { return files[name] ? JSON.parse(strFromU8(files[name])) : fallback; } catch { return fallback; }
  };
  const meta = json('project.json', null);
  if (!meta || meta.app !== 'capy-note') throw new Error('Keine gültige Capy-note-Projektdatei.');
  if (meta.formatVersion > 1) throw new Error('Projektformat ist neuer als diese App-Version – bitte App aktualisieren.');

  const seg = json('index/segmentation.json', []);
  const overrides = json('overrides/overrides.json', {});
  const grading = json('grading/grades.json', { students: {} });
  const red = json('annotations/red.json', {});
  const green = json('annotations/green.json', {});
  const tpl = json('template/tasks.json', { tasks: [] });

  const students = seg.map(s => {
    const g = grading.students?.[s.id] || {};
    const ann = {};
    [[red, 'first'], [green, 'second']].forEach(([src, role]) => {
      Object.entries(src?.[s.id] || {}).forEach(([k, arr]) => {
        ann[k] = [...(ann[k] || []), ...arr.map(a => ({ ...a, role }))];
      });
    });
    return {
      id: s.id, name: s.name || '', pageStart: s.pageStart, pages: s.pages || [],
      grades: g.grades || {}, finalTotal: g.finalTotal, pending: g.pending || [],
      diagnostics: g.diagnostics || {},
      annotations: ann,
      regionOverrides: overrides[s.id] || undefined,
    };
  });

  const pdf = files['source/class.pdf'];
  const pdfArrayBuffer = pdf ? pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) : undefined;

  if (pdfArrayBuffer && meta.sourcePdfSha256) {
    const h = await sha256Hex(pdfArrayBuffer);
    if (h !== meta.sourcePdfSha256) throw new Error('Prüfsumme des Quell-PDFs stimmt nicht – die Datei ist beschädigt.');
  }

  return {
    ...meta,
    correctionMarks: meta.correctionMarks || undefined,
    students,
    tasks: migrateTaskRegions(tpl.tasks || []),
    scoreFields: tpl.scoreFields || {},
    taskPointPositions: tpl.taskPointPositions || {},
    gradeTable: grading.gradeTable,
    modelSolutions: json('annotations/model.json', {}),
    pdfArrayBuffer,
  };
};

const exportProjectAsZip = async (projectData, password /* string | null */) => {
  let bytes = await buildProjectZip(projectData);
  if (password) bytes = await encryptBytes(bytes, password);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const link = document.createElement('a');
  link.download = `${(sanitizeFileName(projectData.title) || 'Projekt').replace(/\s+/g, '_')}${projectData.correctionRole === 'second' ? '_Zweitkorrektur' : ''}.capyz`;
  link.href = URL.createObjectURL(blob);
  link.click();
  setTimeout(() => { try { URL.revokeObjectURL(link.href); } catch {} }, 5000);
};

const importProjectFromZip = async (file, askPassword /* () => Promise<string|null> */, vaultPassword) => {
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (isEncryptedContainer(bytes)) {
    let decrypted = null;
    if (vaultPassword) {
      try { decrypted = await decryptBytes(bytes, vaultPassword); } catch { /* Tresor passt nicht – manuell fragen */ }
    }
    if (!decrypted) {
      const pw = await askPassword();
      if (!pw) throw new Error('Import abgebrochen.');
      try { decrypted = await decryptBytes(bytes, pw); }
      catch { throw new Error('Falsches Passwort oder beschädigte Datei.'); }
    }
    bytes = decrypted;
  }
  if (!isZipBytes(bytes)) throw new Error('Keine gültige Projektdatei (.capyz).');
  return readProjectZip(bytes);
};

// ==================== Migration: pageStart -> pages[] ====================
// Jeder Schüler erhält eine eigene Seitenliste mit Rotation. Damit sind alle
// Scan-Fehlerfälle reparierbar: fehlende/doppelte Seiten, vertauschte
// Reihenfolge, gedrehte Seiten, falsch geschnittene Blöcke.
const migrateStudentPages = (project) => {
  if (!project?.students?.length) return project;
  if (project.students.every(s => Array.isArray(s.pages) && s.pages.length)) return project;
  const pps = project.pagesPerStudent || 1;
  const total = project.pageCount || Infinity;
  return {
    ...project,
    students: project.students.map((s, i) => {
      if (Array.isArray(s.pages) && s.pages.length) return s;
      const start = s.pageStart ?? (i * pps + 1);
      const pages = [];
      for (let k = 0; k < pps; k++) {
        if (start + k <= total) pages.push({ pdfPage: start + k, rotation: 0 });
      }
      return { ...s, pages };
    }),
  };
};

// ==================== Musterlösung (Model Solution) ====================
const MODEL_ROLE = 'solution';
const defaultModelOpacity = 0.35;
const toModelOverlayAnnotation = (a, opacity = defaultModelOpacity) => ({
  ...a,
  role: MODEL_ROLE,
  color: `rgba(107,114,128,${opacity})`,
});

// ==================== Footer Component ====================
function Footer({ darkMode }) {
  return (
    <footer className={`py-3 px-4 text-center text-xs border-t ${darkMode ? 'border-gray-800 bg-gray-900/60 text-gray-500' : 'border-gray-200 bg-white/80 text-gray-500'} backdrop-blur-sm`}>
      <span>Capy-note Version {APP_VERSION}&nbsp;&nbsp;&nbsp;© {APP_AUTHOR}</span>
    </footer>
  );
}

// ==================== Toast Notification ====================
function Toast({ message, type = 'success', onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  const colors = {
    success: 'bg-green-600 text-white',
    error: 'bg-red-600 text-white',
    info: 'bg-blue-600 text-white',
    warning: 'bg-amber-600 text-white',
  };
  const icons = {
    success: <CheckCircle2 size={18} />,
    error: <AlertTriangle size={18} />,
    info: <Save size={18} />,
    warning: <AlertTriangle size={18} />,
  };
  return (
    <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-slide-up ${colors[type]}`}>
      {icons[type]}
      <span className="font-medium">{message}</span>
    </div>
  );
}

// ==================== Demo PDF für Vorschau ====================
const createDemoPdf = (pageCount = 4) => ({
  numPages: pageCount,
  getPage: async (num) => ({
    getViewport: ({ scale }) => ({ width: 595 * scale, height: 842 * scale }),
    render: ({ canvasContext, viewport }) => {
      const ctx = canvasContext;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, viewport.width, viewport.height);
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(20, 20, viewport.width - 40, 60);
      ctx.fillStyle = '#374151';
      ctx.font = `${16 * (viewport.width / 595)}px sans-serif`;
      ctx.fillText(`Seite ${num}`, 40, 55);
      for (let i = 0; i < 6; i++) {
        const y = 120 + i * 100;
        ctx.fillStyle = '#f9fafb';
        ctx.fillRect(40, y, viewport.width - 80, 80);
        ctx.strokeStyle = '#e5e7eb';
        ctx.strokeRect(40, y, viewport.width - 80, 80);
        ctx.fillStyle = '#9ca3af';
        ctx.font = `${12 * (viewport.width / 595)}px sans-serif`;
        ctx.fillText(`Aufgabenbereich ${i + 1}`, 50, y + 45);
      }
      return { promise: Promise.resolve() };
    }
  })
});

// ==================== PDF.js (lokal gebündelt – offlinefähig) ====================
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const loadPdfJs = async () => pdfjsLib;

// ==================== Defaults ====================
const defaultGradeTableSekI = [
  { minPercent: 92, grade: '1' }, { minPercent: 81, grade: '2' }, { minPercent: 67, grade: '3' },
  { minPercent: 50, grade: '4' }, { minPercent: 25, grade: '5' }, { minPercent: 0, grade: '6' },
];
const defaultGradeTableSekII = [
  { minPercent: 95, grade: '15' }, { minPercent: 90, grade: '14' }, { minPercent: 85, grade: '13' },
  { minPercent: 80, grade: '12' }, { minPercent: 75, grade: '11' }, { minPercent: 70, grade: '10' },
  { minPercent: 65, grade: '09' }, { minPercent: 60, grade: '08' }, { minPercent: 55, grade: '07' },
  { minPercent: 50, grade: '06' }, { minPercent: 45, grade: '05' }, { minPercent: 40, grade: '04' },
  { minPercent: 33, grade: '03' }, { minPercent: 27, grade: '02' }, { minPercent: 20, grade: '01' },
  { minPercent: 0, grade: '00' },
];
const defaultCorrectionMarks = [
  { id: 'gr', symbol: 'Gr', name: 'Grammatik', color: '#ef4444' },
  { id: 'o', symbol: 'O', name: 'Orthographie', color: '#f97316' },
  { id: 'v', symbol: 'V', name: 'Vokabular', color: '#eab308' },
  { id: 'conj', symbol: 'Conj', name: 'Konjugation', color: '#22c55e' },
  { id: 'acc', symbol: 'Acc', name: 'Akzent', color: '#3b82f6' },
  { id: 'g', symbol: 'G', name: 'Genus', color: '#8b5cf6' },
  { id: 'check_red', symbol: '✓', name: 'Roter Haken', color: '#ef4444', style: 'stamp', stampVariant: 'check' },
  { id: 'check_red_crossed', symbol: '✓', name: 'Durchgestrichener roter Haken', color: '#ef4444', style: 'stamp', stampVariant: 'check_crossed', crossed: true },
  { id: 'omission_red', symbol: '', name: 'Auslassungszeichen', color: '#ef4444', style: 'stamp', stampVariant: 'omission' },
];

const REQUIRED_CORRECTION_MARKS = [
  { id: 'check_red', symbol: '✓', name: 'Roter Haken', color: '#ef4444', style: 'stamp', stampVariant: 'check' },
  { id: 'check_red_crossed', symbol: '✓', name: 'Durchgestrichener roter Haken', color: '#ef4444', style: 'stamp', stampVariant: 'check_crossed', crossed: true },
  { id: 'omission_red', symbol: '', name: 'Auslassungszeichen', color: '#ef4444', style: 'stamp', stampVariant: 'omission' },
];

const underlineStyles = [
  { id: 'solid', name: 'Durchgezogen', label: '—' },
  { id: 'dashed', name: 'Gestrichelt', label: '- -' },
  { id: 'dotted', name: 'Gepunktet', label: '···' },
  { id: 'wavy', name: 'Wellig', label: '∿' },
];

const isRequiredCorrectionMark = (mark) => REQUIRED_CORRECTION_MARKS.some(req => req.id === mark?.id);

const ensureRequiredCorrectionMarks = (marks) => {
  const base = Array.isArray(marks) ? [...marks] : [];
  const byId = new Map(base.map(m => [m.id, { ...m }]));
  REQUIRED_CORRECTION_MARKS.forEach(req => {
    byId.set(req.id, { ...req, ...(byId.get(req.id) || {}), ...req });
  });
  return Array.from(byId.values()).map(m => {
    if (m.id === 'check_red') return { ...m, style: 'stamp', color: '#ef4444', stampVariant: 'check', crossed: false, symbol: '✓', name: 'Roter Haken' };
    if (m.id === 'check_red_crossed') return { ...m, style: 'stamp', color: '#ef4444', stampVariant: 'check_crossed', crossed: true, symbol: '✓', name: 'Durchgestrichener roter Haken' };
    if (m.id === 'omission_red') return { ...m, style: 'stamp', color: '#ef4444', stampVariant: 'omission', crossed: false, symbol: '', name: 'Auslassungszeichen' };
    if ((m.style || 'badge') !== 'stamp') return { ...m, crossed: false };
    return { ...m, crossed: false };
  });
};

const getStampVariant = (mark) => {
  if (mark?.stampVariant) return mark.stampVariant;
  if (mark?.id === 'check_red') return 'check';
  if (mark?.id === 'check_red_crossed') return 'check_crossed';
  if (mark?.crossed) return 'check_crossed';
  if ((mark?.style || 'badge') === 'stamp' && (mark?.symbol || '') === '✓') return 'check';
  return 'custom';
};

const getAnnotationMarkSizePx = (a, regionHeightPx, fallback = 24) => {
  const rel = a?.sizeRel;
  if (Number.isFinite(rel) && rel > 0) return (rel / 100) * Math.max(1, regionHeightPx);
  const px = a?.size;
  if (Number.isFinite(px) && px > 0) return px;
  return fallback;
};

const pointToSegmentDistance = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
};

const formatHalfPoints = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return n.toFixed(1).replace('.', ',');
};

const STAMP_VECTOR_DATA = {
  // Handwritten check: shorter left arm, longer right arm
  check: {
    main: 'M 24 36 Q 24 52 28 66 Q 31 78 36 72 Q 55 38 88 9',
  },
  // Half-check: same base shape with a nearly horizontal strike across the long arm only
  check_crossed: {
    main: 'M 24 36 Q 24 52 28 66 Q 31 78 36 72 Q 55 38 88 9',
    accent: 'M 48 45 Q 60 44 74 45',
  },
  // Omission mark: clearer handwritten V, more symmetric and distinct from the check
  omission: {
    main: 'M 23 16 Q 31 40 45 86 Q 61 40 81 16',
  },
};

const drawCanvasMark = (ctx, { x, y, symbol, color, size, crossed = false, opacity = 1, stampVariant }) => {
  const fs = Math.max(10, size || 24);
  const variant = stampVariant || (crossed ? 'check_crossed' : 'custom');
  ctx.save();
  ctx.globalAlpha = opacity;

  if (variant === 'check' || variant === 'check_crossed' || variant === 'omission') {
    const vector = STAMP_VECTOR_DATA[variant];
    const scale = fs / 100;
    ctx.translate(x - fs / 2, y - fs / 2);
    ctx.scale(scale, scale);
    ctx.strokeStyle = color;
    ctx.lineWidth = variant === 'omission' ? 8.5 : 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(vector.main));
    if (vector.accent) {
      ctx.stroke(new Path2D(vector.accent));
    }
    ctx.restore();
    return;
  }

  ctx.fillStyle = color;
  ctx.font = `700 ${fs}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(symbol || '', x, y);
  ctx.restore();
};

function StampPreview({ mark, size = 20 }) {
  const color = mark?.color || '#ef4444';
  const variant = getStampVariant(mark);

  if (variant === 'check' || variant === 'check_crossed' || variant === 'omission') {
    const vector = STAMP_VECTOR_DATA[variant];
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" className="overflow-visible">
        <path d={vector.main} fill="none" stroke={color} strokeWidth={variant === 'omission' ? 8.5 : 8} strokeLinecap="round" strokeLinejoin="round" />
        {vector.accent && <path d={vector.accent} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    );
  }

  return (
    <span className="inline-block leading-none font-bold" style={{ color, fontSize: `${size}px`, lineHeight: 1 }}>
      {mark?.symbol || '✓'}
    </span>
  );
}

const drawCanvasUnderline = (ctx, { x, y, width, color, lineWidth = 2, style = 'solid', double = false, hook = false }) => {
  const lw = Math.max(1, lineWidth);
  // Doppellinien eng führen, aber mit sichtbarem Abstand (~1 mm auf typischen Displays)
  const gap = double ? Math.max(2.8, lw * 1.35) : 0;
  const lines = double ? [y - gap / 2, y + gap / 2] : [y];

  const drawOne = (yy) => {
    if (style === 'wavy') {
      ctx.beginPath();
      const amp = 2 + lw * 0.3;
      const wl = 6 + lw * 0.5;
      for (let px = 0; px <= width; px += 0.5) {
        const wx = x + px;
        const wy = yy + Math.sin((px / wl) * Math.PI * 2) * amp;
        if (px === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
      }
      ctx.stroke();
      return;
    }
    if (style === 'dashed') ctx.setLineDash([8, 4]);
    else if (style === 'dotted') ctx.setLineDash([2, 4]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + width, yy);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  lines.forEach(drawOne);

  if (hook) {
    const yy = lines[lines.length - 1];
    const hx = x + width;
    const hookLen = Math.max(6, lw * 3.2);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(hx, yy);
    ctx.lineTo(hx - hookLen * 0.28, yy + hookLen * 0.52);
    ctx.stroke();
  }

  ctx.restore();
};

// ==================== Helpers ====================
const normalizeGradeTable = (gt) => {
  if (Array.isArray(gt)) return { mode: 'percent', rows: gt };               // Altformat
  if (gt && Array.isArray(gt.rows)) return { mode: gt.mode === 'points' ? 'points' : 'percent', rows: gt.rows };
  return { mode: 'percent', rows: [...defaultGradeTableSekI] };
};

const calculateGrade = (points, maxPoints, gradeTable) => {
  const gt = normalizeGradeTable(gradeTable);
  if (!gt.rows.length || maxPoints === 0) return '-';
  if (gt.mode === 'points') {
    const rows = [...gt.rows].sort((a, b) => (b.minPoints ?? 0) - (a.minPoints ?? 0));
    for (const row of rows) if (points >= (row.minPoints ?? 0)) return row.grade;
    return rows[rows.length - 1]?.grade || '-';
  }
  const percent = (points / maxPoints) * 100;
  const rows = [...gt.rows].sort((a, b) => (b.minPercent ?? 0) - (a.minPercent ?? 0));
  for (const row of rows) if (percent >= (row.minPercent ?? 0)) return row.grade;
  return rows[rows.length - 1]?.grade || '-';
};

// Erkennt das Sek-II-Notenpunktesystem (0–15) am Wertebereich der Noten
const isSekIIGradeTable = (gradeTable) => {
  const gt = normalizeGradeTable(gradeTable);
  const nums = gt.rows
    .map(r => parseFloat(String(r?.grade ?? '').replace(',', '.')))
    .filter(n => Number.isFinite(n));
  return nums.length ? Math.max(...nums) > 6 : false;
};

// Umrechnungsvorlagen: nur Grenzen + Noten, keinerlei Schülerdaten -> localStorage ok
const loadGradeTemplates = () => {
  try { return JSON.parse(localStorage.getItem('capynote_gradeTemplates') || '[]'); } catch { return []; }
};
const saveGradeTemplates = (list) => {
  try { localStorage.setItem('capynote_gradeTemplates', JSON.stringify(list)); } catch { /* ignore */ }
};

// Kompatibilität zur 1.5.2-Anzeige („01 P."): Sek-II-Erkennung auf neuem Format
const isPointsGradeTable = (gt) => isSekIIGradeTable(normalizeGradeTable(gt));

const formatGradeDisplay = (grade, gradeTable) => {
  const g = (grade ?? '-').toString();
  if (g === '-' || g.trim() === '') return '-';
  if (!isPointsGradeTable(gradeTable)) return g;

  // Notenpunkte: 01–15 => "01 P."
  const n = parseInt(g, 10);
  if (!Number.isFinite(n)) return g;
  if (n >= 1 && n <= 15) return `${String(n).padStart(2, '0')} P.`;
  if (n === 0) return '00';
  return g;
};

const formatBE = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  // BE are typically .5 steps
  const rounded = Math.round(n * 2) / 2;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/\.0$/, '');
};

const getTasksMaxPoints = (tasks = []) => (tasks || []).reduce((sum, t) => sum + (Number(t?.maxPoints) || 0), 0);
const getStudentRawTotal = (student, tasks = [], pointsKey = 'points') => (
  (tasks || []).reduce((sum, t) => sum + (Number(student?.grades?.[t.id]?.[pointsKey]) || 0), 0)
);
const getStudentCappedTotal = (student, tasks = [], pointsKey = 'points') => {
  const maxPoints = getTasksMaxPoints(tasks);
  return Math.min(maxPoints, getStudentRawTotal(student, tasks, pointsKey));
};
const isBonusScore = (points, maxPoints) => Number.isFinite(Number(points)) && Number(points) > Number(maxPoints);

const getTaskDisplayName = (task, tasks = []) => {
  if (!task) return '';
  const explicitName = (task.name || task.label || '').trim();
  if (explicitName) return explicitName;
  const idx = (tasks || []).findIndex(t => t.id === task.id);
  return idx >= 0 ? `Aufgabe ${idx + 1}` : (task.id || 'Aufgabe');
};


// ==================== Modal ====================
function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative z-10 max-h-[90vh] overflow-auto animate-modal-in" onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  );
}

// ==================== Passwort-Dialog (Schritt 10) ====================
function PasswordDialog({ title, description, confirmInput = false, onSubmit, onCancel, darkMode }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const valid = confirmInput ? (pw.length >= 8 && pw === pw2) : pw.length > 0;
  const inputCls = `w-full px-4 py-2.5 rounded-xl border mb-2 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`;
  return (
    <Modal onClose={onCancel}>
      <div className={`rounded-2xl w-[420px] p-6 ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <h3 className="font-semibold text-lg mb-1">{title}</h3>
        {description && <p className={`text-sm mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{description}</p>}
        <input type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)}
          placeholder={confirmInput ? 'Passwort (min. 8 Zeichen)' : 'Passwort'}
          onKeyDown={e => { if (e.key === 'Enter' && valid) onSubmit(pw); }} className={inputCls} />
        {confirmInput && (
          <>
            <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Passwort wiederholen"
              onKeyDown={e => { if (e.key === 'Enter' && valid) onSubmit(pw); }} className={inputCls} />
            <p className="text-xs text-amber-500 mb-2">
              <AlertTriangle size={12} className="inline mr-1" />
              Echte Verschlüsselung: Bei Passwortverlust gibt es keine Wiederherstellung.
            </p>
          </>
        )}
        <div className="flex gap-3 mt-3">
          <button onClick={onCancel} className={`flex-1 py-2.5 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Abbrechen</button>
          <button onClick={() => onSubmit(pw)} disabled={!valid}
            className="flex-1 py-2.5 bg-amber-600 text-white rounded-xl font-medium disabled:opacity-40">OK</button>
        </div>
      </div>
    </Modal>
  );
}

// ==================== ZIP-Export-Dialog (Schritt 10) ====================
function ExportZipDialog({ title = 'Projekt als ZIP exportieren', vaultUnlocked, onExport, onClose, darkMode }) {
  const [mode, setMode] = useState(vaultUnlocked ? 'vault' : 'password');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const pwValid = pw.length >= 8 && pw === pw2;
  const canExport = mode !== 'password' || pwValid;
  const inputCls = `w-full px-4 py-2.5 rounded-xl border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`;
  const radio = (m, label, hint, disabled = false) => (
    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${mode === m ? (darkMode ? 'bg-gray-800' : 'bg-gray-100') : ''}`}>
      <input type="radio" checked={mode === m} disabled={disabled} onChange={() => setMode(m)} className="mt-1" />
      <span><span className="text-sm font-medium">{label}</span><br />
        <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>{hint}</span></span>
    </label>
  );
  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[470px] p-6 ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <h3 className="font-semibold text-lg mb-3">{title}</h3>
        {radio('password', 'Mit Passwort (dieses Projekt)', 'AES-256-verschlüsselt; das Passwort wird beim Import abgefragt.')}
        {radio('vault', 'Mit Tresor-Schlüssel', vaultUnlocked ? 'Verwendet das in dieser Sitzung entsperrte Tresor-Passwort.' : 'Tresor ist nicht entsperrt (Dashboard → Tresor).', !vaultUnlocked)}
        {radio('none', 'Unverschlüsselt', 'Enthält Schülerdaten im Klartext – nur für sichere Umgebungen.')}
        {mode === 'password' && (
          <div className="mt-3 space-y-2">
            <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Passwort (min. 8 Zeichen)" className={inputCls} />
            <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Passwort wiederholen" className={inputCls} />
            <p className="text-xs text-amber-500"><AlertTriangle size={12} className="inline mr-1" />Bei Passwortverlust keine Wiederherstellung.</p>
          </div>
        )}
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className={`flex-1 py-2.5 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Abbrechen</button>
          <button onClick={() => onExport(mode === 'none' ? null : mode === 'vault' ? 'VAULT' : pw)} disabled={!canExport}
            className="flex-1 py-2.5 bg-amber-600 text-white rounded-xl font-medium disabled:opacity-40">Exportieren</button>
        </div>
      </div>
    </Modal>
  );
}

// ==================== Bewertungsraster-Panel (Schritt 11) ====================
function RubricPanel({ task, selection, onSelect, darkMode }) {
  const [open, setOpen] = useState(true);
  const r = task.rubric;
  const sum = Object.values(selection).reduce((a, b) => a + (b || 0), 0);
  const capped = Math.min(sum, task.maxPoints);
  return (
    <div className={`px-4 py-2 border-b text-sm ${darkMode ? 'border-gray-800 bg-gray-900/60' : 'border-gray-200 bg-white'}`}>
      <button onClick={() => setOpen(o => !o)} className="font-medium flex items-center gap-2">
        <ChevronDown size={14} className={open ? '' : '-rotate-90'} />
        Bewertungsraster: {r.name}
        <span className={darkMode ? 'text-gray-500' : 'text-gray-500'}>
          ({formatBE(capped)} / {formatBE(task.maxPoints)} BE{sum > task.maxPoints ? ', gedeckelt' : ''})
        </span>
      </button>
      {open && r.criteria.map(c => {
        const chosen = c.levels.find(l => l.points === selection[c.id]);
        return (
          <div key={c.id} className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="w-64 truncate" title={c.name}>{c.name}</span>
            {c.levels.map(l => (
              <button key={l.points} onClick={() => onSelect(c.id, l.points)}
                title={`${l.label}: ${l.description}`}
                className={`px-2.5 py-1 rounded font-mono ${selection[c.id] === l.points
                  ? 'bg-amber-600 text-white'
                  : darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>
                {l.points}
              </button>
            ))}
            {chosen && (
              <span className={`text-xs max-w-md truncate ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                title={chosen.description}>{chosen.label}</span>
            )}
          </div>
        );
      })}
      {open && r.note && (
        <p className={`text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>{r.note}</p>
      )}
    </div>
  );
}

// ==================== Grade Table Editor ====================
function GradeTableEditor({ gradeTable, maxPts = 0, onChange, onClose, darkMode }) {
  const init = normalizeGradeTable(gradeTable);
  const [mode, setMode] = useState(init.mode);
  const [rows, setRows] = useState(init.rows.map(r => ({ ...r })));
  const [templates, setTemplates] = useState(loadGradeTemplates());
  const [tplName, setTplName] = useState('');

  const minKey = mode === 'points' ? 'minPoints' : 'minPercent';

  // Moduswechsel: fehlende Grenzen aus dem jeweils anderen Modus vorschlagen, vorhandene behalten
  const switchMode = (m) => {
    if (m === mode) return;
    setRows(rs => rs.map(r => m === 'points'
      ? { ...r, minPoints: r.minPoints ?? Math.round(((r.minPercent ?? 0) / 100) * maxPts * 2) / 2 }
      : { ...r, minPercent: r.minPercent ?? (maxPts > 0 ? Math.round(((r.minPoints ?? 0) / maxPts) * 1000) / 10 : 0) }
    ));
    setMode(m);
  };

  const setVal = (i, v) => setRows(rs => { const u = rs.map(r => ({ ...r })); u[i][minKey] = v; return u; });
  const setGrade = (i, g) => setRows(rs => { const u = rs.map(r => ({ ...r })); u[i].grade = g; return u; });
  const delRow = (i) => setRows(rs => rs.filter((_, j) => j !== i));
  const addRow = () => setRows(rs => [...rs, { grade: '', [minKey]: 0 }]);

  // Bereichs-Anzeige (obere Grenze = nächsthöhere Untergrenze − 0,5 BE)
  const sortedIdx = [...rows.keys()].sort((a, b) => ((rows[b][minKey] ?? 0) - (rows[a][minKey] ?? 0)));
  const upperFor = (i) => {
    const pos = sortedIdx.indexOf(i);
    if (pos <= 0) return mode === 'points' ? maxPts : 100;
    const above = rows[sortedIdx[pos - 1]][minKey] ?? 0;
    return mode === 'points' ? Math.max(above - 0.5, rows[i][minKey] ?? 0) : above;
  };

  // Validierung
  const vals = rows.map(r => r[minKey]);
  const issues = [];
  if (!rows.length) issues.push('Die Tabelle ist leer.');
  if (rows.some(r => !String(r.grade ?? '').trim())) issues.push('Mindestens eine Zeile hat keine Note.');
  if (new Set(vals.map(v => v ?? '∅')).size !== vals.length) issues.push('Doppelte Untergrenzen – jede Note braucht eine eigene Grenze.');
  if (mode === 'points') {
    if (vals.some(v => v == null || isNaN(v) || v < 0 || (maxPts > 0 && v > maxPts))) issues.push(`Untergrenzen müssen zwischen 0 und ${formatBE(maxPts)} BE liegen.`);
    if (vals.some(v => v != null && !isNaN(v) && Math.round(v * 2) !== v * 2)) issues.push('Untergrenzen bitte in 0,5-BE-Schritten angeben.');
  } else if (vals.some(v => v == null || isNaN(v) || v < 0 || v > 100)) {
    issues.push('Prozentgrenzen müssen zwischen 0 und 100 liegen.');
  }
  const validVals = vals.filter(v => v != null && !isNaN(v));
  const minVal = validVals.length ? Math.min(...validVals) : null;
  const bottomInfo = (minVal != null && minVal > 0)
    ? `Ergebnisse unter ${mode === 'points' ? `${formatBE(minVal)} BE` : `${minVal} %`} erhalten die unterste Note der Tabelle.`
    : null;

  // Vorlagen
  const loadTpl = (t) => { setMode(t.table.mode === 'points' ? 'points' : 'percent'); setRows(t.table.rows.map(r => ({ ...r }))); };
  const saveTpl = () => {
    const name = tplName.trim();
    if (!name) return;
    const next = [...templates.filter(t => t.name !== name), { id: `gt_${Date.now()}`, name, table: { mode, rows: rows.map(r => ({ ...r })) } }];
    setTemplates(next); saveGradeTemplates(next); setTplName('');
  };
  const delTpl = (t) => { const next = templates.filter(x => x.id !== t.id); setTemplates(next); saveGradeTemplates(next); };

  const segBtn = (active) => `px-3 py-1.5 text-sm ${active ? 'bg-amber-600 text-white' : darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200'}`;
  const smallBtn = `px-3 py-1.5 rounded text-sm ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`;

  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[560px] max-h-[85vh] flex flex-col ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className={`p-4 border-b flex justify-between items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div>
            <span className="font-semibold">Bewertungstabelle</span>
            <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>Gesamt: {formatBE(maxPts)} BE</p>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
        </div>

        <div className="p-4 flex gap-2 flex-wrap items-center">
          <div className={`flex rounded-lg overflow-hidden border ${darkMode ? 'border-gray-700' : 'border-gray-300'}`}>
            <button onClick={() => switchMode('percent')} className={segBtn(mode === 'percent')}>Prozentgrenzen</button>
            <button onClick={() => switchMode('points')} className={segBtn(mode === 'points')}>Punktebereiche</button>
          </div>
          <div className="ml-auto flex gap-2">
            <button onClick={() => { setMode('percent'); setRows(defaultGradeTableSekI.map(r => ({ ...r }))); }} className={smallBtn}>Sek I (1–6)</button>
            <button onClick={() => { setMode('percent'); setRows(defaultGradeTableSekII.map(r => ({ ...r }))); }} className={smallBtn}>Sek II (0–15)</button>
          </div>
        </div>

        <div className="px-4 pb-2 flex-1 overflow-y-auto">
          <div className={`grid grid-cols-[95px_1fr_90px_36px] gap-2 mb-2 text-xs px-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
            <span>{mode === 'points' ? 'Ab BE' : 'Ab Prozent'}</span><span>Bereich</span><span>Note</span><span></span>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[95px_1fr_90px_36px] gap-2 mb-2 items-center">
              <input type="number" step={mode === 'points' ? 0.5 : 1} min="0" max={mode === 'points' ? (maxPts || undefined) : 100}
                value={r[minKey] ?? ''} onChange={e => setVal(i, e.target.value === '' ? null : parseFloat(e.target.value))}
                className={`px-3 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} />
              <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                {mode === 'points'
                  ? `${formatBE(r[minKey] ?? 0)} – ${formatBE(upperFor(i))} BE`
                  : `ab ${r[minKey] ?? 0} %`}
              </span>
              <input type="text" value={r.grade ?? ''} onChange={e => setGrade(i, e.target.value)} placeholder="Note"
                className={`px-3 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} />
              <button onClick={() => delRow(i)} className="p-1.5 rounded text-red-400 hover:bg-red-500/20"><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={addRow} className={`w-full py-2 rounded-lg border-2 border-dashed text-sm ${darkMode ? 'border-gray-700 text-gray-500 hover:border-amber-500' : 'border-gray-300 text-gray-500 hover:border-amber-500'}`}>
            <Plus size={14} className="inline mr-1" />Zeile hinzufügen
          </button>
        </div>

        {(issues.length > 0 || bottomInfo) && (
          <div className={`mx-4 mb-2 p-3 rounded-xl text-sm ${issues.length ? (darkMode ? 'bg-amber-900/20 text-amber-400' : 'bg-amber-50 text-amber-700') : (darkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-600')}`}>
            {issues.map((msg, i) => <p key={i}><AlertTriangle size={13} className="inline mr-1" />{msg}</p>)}
            {!issues.length && bottomInfo && <p>{bottomInfo}</p>}
          </div>
        )}

        <div className={`px-4 py-3 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <p className="text-sm font-medium mb-2">Vorlagen</p>
          <div className="flex gap-2">
            <input value={tplName} onChange={e => setTplName(e.target.value)} placeholder="Name (z. B. Schulaufgabe F2)"
              className={`flex-1 px-3 py-2 rounded border text-sm ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} />
            <button onClick={saveTpl} disabled={!tplName.trim() || issues.length > 0}
              className="px-4 py-2 rounded-lg text-sm bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40">Speichern</button>
          </div>
          {templates.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {templates.map(t => (
                <span key={t.id} className={`flex items-center gap-1 pl-2 pr-1 py-1 rounded-full text-xs ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                  <button onClick={() => loadTpl(t)} className="hover:underline" title="Vorlage laden">{t.name}</button>
                  <button onClick={() => delTpl(t)} className="p-0.5 rounded text-gray-500 hover:text-red-400" title="Vorlage löschen"><X size={10} /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className={`p-4 border-t flex gap-3 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <button onClick={onClose} className={`flex-1 py-2.5 rounded-xl ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>Abbrechen</button>
          <button onClick={() => { onChange({ mode, rows: rows.map(r => ({ ...r })) }); onClose(); }} disabled={issues.length > 0}
            className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-medium disabled:opacity-40">Übernehmen</button>
        </div>
      </div>
    </Modal>
  );
}
// ==================== Correction Marks Editor ====================


function CorrectionMarksEditor({ marks, onChange, onClose, darkMode }) {
  const [items, setItems] = useState(ensureRequiredCorrectionMarks((marks || []).map(m => ({
    style: 'badge',
    crossed: false,
    ...m,
  }))));

  const updateItem = (index, patch) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      if (isRequiredCorrectionMark(item)) return item;
      const next = { ...item, ...patch };
      if ((next.style || 'badge') !== 'stamp') {
        next.crossed = false;
        next.stampVariant = undefined;
      } else {
        next.stampVariant = next.stampVariant || 'custom';
      }
      return next;
    }));
  };

  const addItem = (style = 'badge') => {
    const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setItems(prev => ([
      ...prev,
      style === 'stamp'
        ? { id, symbol: '✓', name: 'Stempel', color: '#ef4444', style: 'stamp', crossed: false, stampVariant: 'custom' }
        : { id, symbol: '', name: '', color: '#888888', style: 'badge', crossed: false }
    ]));
  };

  const previewMark = (m) => {
    if ((m.style || 'badge') === 'stamp') return <StampPreview mark={m} size={22} />;
    return <span className="font-bold text-sm" style={{ color: m.color }}>{m.symbol || '—'}</span>;
  };

  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[760px] max-w-[96vw] ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className={`p-4 border-b flex justify-between items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div>
            <span className="font-semibold">Korrekturzeichen</span>
            <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Palette bearbeiten: Haken, durchgestrichener Haken und Auslassungszeichen bleiben immer verfügbar. Durchstreichung ist nur für den halben Haken vorgesehen.</p>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
        </div>

        <div className="p-4 max-h-[65vh] overflow-y-auto">
          <div className={`grid grid-cols-[70px_110px_1fr_56px_92px_84px_40px] gap-2 px-1 pb-2 text-xs font-medium uppercase tracking-wide ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
            <div>Vorschau</div>
            <div>Typ</div>
            <div>Name / Kürzel</div>
            <div>Farbe</div>
            <div>Kürzel</div>
            <div>Hinweis</div>
            <div></div>
          </div>

          {items.map((m, i) => (
            <div key={m.id} className={`grid grid-cols-[70px_110px_1fr_56px_92px_84px_40px] gap-2 mb-2 p-2 rounded-xl ${darkMode ? 'bg-gray-800/70' : 'bg-gray-50'}`}>
              <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-500/40 min-h-11">
                {previewMark(m)}
              </div>

              <select
                value={m.style || 'badge'}
                disabled={isRequiredCorrectionMark(m)}
                onChange={e => updateItem(i, { style: e.target.value })}
                className={`px-2 py-2 rounded border text-sm ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'} ${isRequiredCorrectionMark(m) ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <option value="badge">Kürzel</option>
                <option value="stamp">Stempel</option>
              </select>

              <div className="grid grid-cols-[1fr_90px] gap-2">
                <input
                  type="text"
                  value={m.name || ''}
                  disabled={isRequiredCorrectionMark(m)}
                  onChange={e => updateItem(i, { name: e.target.value })}
                  placeholder={m.style === 'stamp' ? 'z. B. Auslassung' : 'z. B. Grammatik'}
                  className={`px-3 py-2 rounded border text-sm ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'} ${isRequiredCorrectionMark(m) ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
                <input
                  type="text"
                  maxLength={8}
                  value={m.symbol || ''}
                  disabled={isRequiredCorrectionMark(m)}
                  onChange={e => updateItem(i, { symbol: e.target.value })}
                  placeholder={m.style === 'stamp' ? '✓' : 'Gr'}
                  className={`px-2 py-2 rounded border text-center font-bold text-sm ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'} ${isRequiredCorrectionMark(m) ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
              </div>

              <input type="color" value={m.color || '#888888'} disabled={isRequiredCorrectionMark(m)} onChange={e => updateItem(i, { color: e.target.value })} className={`w-full h-10 rounded cursor-pointer border-0 bg-transparent ${isRequiredCorrectionMark(m) ? 'opacity-60 cursor-not-allowed' : ''}`} />

              <div className={`flex items-center justify-center rounded-lg text-xs ${darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-300'}`}>
                {m.style === 'stamp' ? ((m.stampVariant && m.stampVariant !== 'custom') ? 'fest' : 'frei') : 'Text'}
              </div>

              <div className={`flex items-center justify-center rounded-lg text-xs ${darkMode ? 'bg-gray-800 border border-gray-700 text-gray-300' : 'bg-white border border-gray-300 text-gray-700'}`}>
                {isRequiredCorrectionMark(m) ? 'Pflicht' : '—'}
              </div>

              <button disabled={isRequiredCorrectionMark(m)} onClick={() => setItems(items.filter((_, j) => j !== i))} className={`p-2 rounded ${isRequiredCorrectionMark(m) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-red-500/20 text-red-400'}`}><Trash2 size={16} /></button>
              <input type="text" value={m.hint || ''}
                placeholder="Tipp für das Rückmeldeblatt (optional), z. B. Übungsverweis"
                onChange={e => updateItem(i, { hint: e.target.value })}
                className={`col-span-7 px-3 py-1.5 rounded border text-xs ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`} />
            </div>
          ))}

          <div className="grid grid-cols-2 gap-2 mt-3">
            <button onClick={() => addItem('badge')} className={`py-2 border-2 border-dashed rounded-xl ${darkMode ? 'border-gray-700 hover:bg-gray-800' : 'border-gray-300 hover:bg-gray-50'}`}>
              <Plus size={16} className="inline mr-1" /> Kürzel hinzufügen
            </button>
            <button onClick={() => addItem('stamp')} className={`py-2 border-2 border-dashed rounded-xl ${darkMode ? 'border-gray-700 hover:bg-gray-800' : 'border-gray-300 hover:bg-gray-50'}`}>
              <Plus size={16} className="inline mr-1" /> Stempel hinzufügen
            </button>
          </div>
        </div>

        <div className={`p-4 border-t flex gap-3 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <button onClick={onClose} className={`flex-1 py-2 rounded ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Abbrechen</button>
          <button
            onClick={() => {
              const cleaned = ensureRequiredCorrectionMarks(items
                .map(m => ({
                  ...m,
                  style: m.style || 'badge',
                  crossed: m.id === 'check_red_crossed',
                  stampVariant: (m.style || 'badge') === 'stamp' ? (m.stampVariant || 'custom') : undefined,
                  symbol: (m.symbol || '').trim(),
                  name: (m.name || '').trim(),
                }))
                .filter(m => ((m.style || 'badge') === 'stamp' ? ((m.stampVariant && m.stampVariant !== 'custom') || m.symbol) : m.symbol)));
              onChange(cleaned);
              onClose();
            }}
            className="flex-1 py-2 bg-amber-600 text-white rounded font-medium"
          >
            Speichern
          </button>
        </div>
      </div>
    </Modal>
  );
}

function UnderlineEditorModal({ entries, onPatch, onDelete, onClose, darkMode }) {
  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[760px] max-w-[96vw] ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className={`p-4 border-b flex justify-between items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div>
            <div className="font-semibold">Unterstreichungen bearbeiten</div>
            <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Bereits gezeichnete Linien können hier nachträglich auf 1 Fehler, 2 Fehler, 0,5 Fehler oder 1,5 Fehler umgestellt werden (einfach/doppelt, jeweils mit oder ohne Häkchen rechts).</p>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
        </div>

        <div className="p-4 max-h-[65vh] overflow-y-auto space-y-3">
          {!entries.length && (
            <div className={`text-sm rounded-xl p-4 ${darkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-50 text-gray-600'}`}>
              Noch keine Unterstreichungen auf dieser Aufgabe.
            </div>
          )}
          {entries.map((entry) => {
            const a = entry.annotation;
            const color = a.color || '#ef4444';
            return (
              <div key={entry.index} className={`grid grid-cols-[120px_1fr_44px] gap-3 items-center rounded-xl p-3 ${darkMode ? 'bg-gray-800/80' : 'bg-gray-50'}`}>
                <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-500/30 h-14">
                  <svg width="92" height="28" viewBox="0 0 92 28">
                    {a.double ? (
                      <>
                        <line x1="8" y1="12.2" x2="82" y2="12.2" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
                        <line x1="8" y1="15.8" x2="82" y2="15.8" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
                        {a.hook && <line x1="82" y1="15.8" x2="75.6" y2="19.3" stroke={color} strokeWidth="2.5" strokeLinecap="round" />}
                      </>
                    ) : (
                      <>
                        <line x1="8" y1="14" x2="82" y2="14" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
                        {a.hook && <line x1="82" y1="14" x2="75.6" y2="17.6" stroke={color} strokeWidth="2.5" strokeLinecap="round" />}
                      </>
                    )}
                  </svg>
                </div>

                <div className="flex flex-wrap gap-2">
                  <select value={a.style || 'solid'} onChange={e => onPatch(entry.index, { style: e.target.value })} className={`px-3 py-2 rounded-lg border text-sm ${darkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-300'}`}>
                    {underlineStyles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button onClick={() => onPatch(entry.index, { double: false })} className={`px-3 py-2 rounded-lg text-sm font-medium ${!a.double ? 'bg-amber-600 text-white' : darkMode ? 'bg-gray-900 border border-gray-700' : 'bg-white border border-gray-300'}`}>Einfach</button>
                  <button onClick={() => onPatch(entry.index, { double: true })} className={`px-3 py-2 rounded-lg text-sm font-medium ${a.double ? 'bg-amber-600 text-white' : darkMode ? 'bg-gray-900 border border-gray-700' : 'bg-white border border-gray-300'}`}>Doppelt</button>
                  <button onClick={() => onPatch(entry.index, { hook: !a.hook })} className={`px-3 py-2 rounded-lg text-sm font-medium ${a.hook ? 'bg-amber-600 text-white' : darkMode ? 'bg-gray-900 border border-gray-700' : 'bg-white border border-gray-300'}`}>Häkchen rechts</button>
                </div>

                <button onClick={() => onDelete(entry.index)} className="p-2 rounded-lg text-red-400 hover:bg-red-500/10" title="Linie löschen"><Trash2 size={16} /></button>
              </div>
            );
          })}
        </div>

        <div className={`p-4 border-t flex gap-3 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <button onClick={onClose} className="flex-1 py-2 bg-amber-600 text-white rounded font-medium">Fertig</button>
        </div>
      </div>
    </Modal>
  );
}


// ==================== Task Editor ====================

function TaskEditor({ task, onSave, onClose, darkMode }) {
  const [name, setName] = useState(task.name);
  const [maxPoints, setMaxPoints] = useState(task.maxPoints);
  const [competence, setCompetence] = useState(task.competence || '');
  const [rubricId, setRubricId] = useState(task.rubric ? 'KEEP' : '');
  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[400px] p-6 ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className="flex justify-between items-center mb-4">
          <span className="font-semibold">Aufgabe bearbeiten</span>
          <button onClick={onClose} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
        </div>
        <div className="space-y-4">
          <div><label className="block text-sm mb-1 font-medium">Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} className={`w-full px-4 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} /></div>
          <div><label className="block text-sm mb-1 font-medium">Maximale BE</label><input type="number" min="0.5" step="0.5" value={maxPoints} onChange={e => setMaxPoints(parseFloat(e.target.value) || 0)} className={`w-full px-4 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} /></div>
          <div><label className="block text-sm mb-1 font-medium">Kompetenzbereich (optional)</label>
            <select value={competence} onChange={e => setCompetence(e.target.value)}
              className={`w-full px-4 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`}>
              <option value="">– keine Zuordnung –</option>
              {COMPETENCES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label className="block text-sm mb-1 font-medium">Bewertungsraster (optional)</label>
            <select value={rubricId} onChange={e => {
              setRubricId(e.target.value);
              const tpl = RUBRIC_TEMPLATES.find(t => t.id === e.target.value);
              if (tpl) setMaxPoints(rubricMax(tpl));
            }} className={`w-full px-4 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`}>
              <option value="">– kein Raster –</option>
              {task.rubric && <option value="KEEP">Aktuell: {task.rubric.name}</option>}
              {RUBRIC_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.group}: {t.name} ({rubricMax(t)} BE)</option>)}
            </select>
            <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>„– kein Raster –" entfernt das Raster; vergebene BE bleiben erhalten.</p>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className={`flex-1 py-2 rounded ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Abbrechen</button>
          <button onClick={() => {
            const rubric = rubricId === 'KEEP' ? task.rubric
              : rubricId ? cloneRubric(RUBRIC_TEMPLATES.find(t => t.id === rubricId)) : undefined;
            onSave({ ...task, name, maxPoints, competence: competence || undefined, rubric });
            onClose();
          }} className="flex-1 py-2 bg-amber-600 text-white rounded font-medium">Speichern</button>
        </div>
      </div>
    </Modal>
  );
}

// ==================== Task Dialog (New) ====================
function TaskDialog({ onSave, onCancel, count, darkMode }) {
  const [name, setName] = useState(`Aufgabe ${count + 1}`);
  const [maxPoints, setMaxPoints] = useState(10);
  const [competence, setCompetence] = useState('');
  const [rubricId, setRubricId] = useState('');
  return (
    <Modal onClose={onCancel}>
      <div className={`rounded-2xl w-[400px] p-6 ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <h3 className="font-semibold mb-4 text-lg">Neue Aufgabe</h3>
        <div className="space-y-4">
          <div><label className="block text-sm mb-1 font-medium">Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus className={`w-full px-4 py-2 border rounded ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} /></div>
          <div><label className="block text-sm mb-1 font-medium">Maximale BE</label><input type="number" min="0.5" step="0.5" value={maxPoints} onChange={e => setMaxPoints(parseFloat(e.target.value) || 0)} className={`w-full px-4 py-2 border rounded ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} /></div>
          <div><label className="block text-sm mb-1 font-medium">Kompetenzbereich (optional)</label>
            <select value={competence} onChange={e => setCompetence(e.target.value)}
              className={`w-full px-4 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`}>
              <option value="">– keine Zuordnung –</option>
              {COMPETENCES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label className="block text-sm mb-1 font-medium">Bewertungsraster (optional)</label>
            <select value={rubricId} onChange={e => {
              setRubricId(e.target.value);
              const tpl = RUBRIC_TEMPLATES.find(t => t.id === e.target.value);
              if (tpl) setMaxPoints(rubricMax(tpl)); // BE-Vorschlag, bleibt editierbar
            }} className={`w-full px-4 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`}>
              <option value="">– kein Raster –</option>
              {RUBRIC_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.group}: {t.name} ({rubricMax(t)} BE)</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onCancel} className={`flex-1 py-2 rounded ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Abbrechen</button>
          <button onClick={() => {
            const tpl = RUBRIC_TEMPLATES.find(t => t.id === rubricId);
            onSave({ name, maxPoints, competence: competence || undefined, rubric: tpl ? cloneRubric(tpl) : undefined });
          }} disabled={!name.trim()} className="flex-1 py-2 bg-amber-600 rounded font-medium text-white disabled:opacity-50">Erstellen</button>
        </div>
      </div>
    </Modal>
  );
}

// ==================== Completion Modal ====================
function CompletionModal({ project, students, tasks, gradeTable, pointsKey = 'points', onClose, onGoToResults, onBack, darkMode }) {
  const maxPts = getTasksMaxPoints(tasks);
  const getTotal = (s) => getStudentCappedTotal(s, tasks, pointsKey);
  const getGrade = (s) => formatGradeDisplay(calculateGrade(getTotal(s), maxPts, gradeTable), gradeTable);
  
  const totals = students.map(s => getTotal(s));
  const grades = students.map(s => getGrade(s));
  const avgPoints = totals.length ? (totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1) : 0;
  const allGraded = students.every(s => tasks.every(t => s.grades?.[t.id]?.[pointsKey] !== undefined));
  const pendingCount = students.reduce((c, s) => c + (s.pending?.length || 0), 0);
  
  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[550px] ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className="p-8 text-center">
          <div className="text-6xl mb-4">{allGraded ? '🎉' : '📋'}</div>
          <h2 className="text-2xl font-bold mb-2">
            {allGraded ? 'Korrektur abgeschlossen!' : 'Korrekturstand'}
          </h2>
          <p className={`${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {allGraded 
              ? 'Alle Schülerarbeiten wurden bewertet.' 
              : `${pendingCount > 0 ? `${pendingCount} übersprungene Bewertungen. ` : ''}Noch nicht alle Aufgaben bewertet.`}
          </p>
        </div>
        
        <div className={`mx-6 p-4 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Schüler</div>
              <div className="text-2xl font-bold">{students.length}</div>
            </div>
            <div>
              <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Ø Punkte</div>
              <div className="text-2xl font-bold">{avgPoints}<span className="text-sm font-normal text-gray-500">/{maxPts}</span></div>
            </div>
            <div>
              <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Ø Note</div>
              <div className="text-2xl font-bold text-amber-500">
                {grades.length ? (grades.reduce((a, g) => a + (parseFloat(g) || 0), 0) / grades.length).toFixed(1) : '-'}
              </div>
            </div>
          </div>
        </div>
        
        {!allGraded && pendingCount > 0 && (
          <div className={`mx-6 mt-3 p-3 rounded-xl border ${darkMode ? 'border-amber-700 bg-amber-900/20' : 'border-amber-300 bg-amber-50'}`}>
            <div className="flex items-center gap-2 text-amber-500">
              <AlertTriangle size={16} />
              <span className="text-sm font-medium">{pendingCount} übersprungene Bewertungen vorhanden</span>
            </div>
          </div>
        )}
        
        <div className="p-6 flex flex-col gap-3">
          <button onClick={onGoToResults} className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
            <Award size={20} /> Ergebnisse ansehen & exportieren
          </button>
          <button onClick={onClose} className={`w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>
            <Edit3 size={18} /> Weiter korrigieren
          </button>
          <button onClick={onBack} className={`w-full py-2.5 rounded-xl text-sm ${darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}>
            Zurück zum Dashboard
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ==================== Delete Reminder Dialog ====================
function DeleteReminderDialog({ onSet, onSkip, darkMode }) {
  const [date, setDate] = useState('');
  return (
    <Modal onClose={onSkip}>
      <div className={`rounded-2xl w-[420px] p-6 ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className="flex items-center gap-3 mb-4">
          <Calendar className="text-amber-500" size={24} />
          <h3 className="font-semibold text-lg">Automatisches Löschen</h3>
        </div>
        <p className={`mb-4 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          Optional: Legen Sie ein Datum fest, nach dem dieses Projekt automatisch gelöscht wird (z. B. nach Notenrückgabe).
          Bereits exportierte .capyz-Sicherungen bleiben davon unberührt und müssen ggf. separat gelöscht werden.
        </p>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} 
          min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
          className={`w-full px-4 py-3 rounded-xl border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} />
        <div className="flex gap-3 mt-6">
          <button onClick={onSkip} className={`flex-1 py-2.5 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Überspringen</button>
          <button onClick={() => onSet(date)} disabled={!date} className="flex-1 py-2.5 bg-amber-600 text-white rounded-xl font-medium disabled:opacity-50">Festlegen</button>
        </div>
      </div>
    </Modal>
  );
}

// ==================== Review / Task Comparison Modal ====================
function ReviewModal({ students, tasks, currentTaskId, currentStudentIndex = 0, pointsKey = 'points', pdfDoc, activeRole = 'first', onClose, onOpenSelection, onSwitchMode, darkMode }) {
  const [selectedTaskId, setSelectedTaskId] = useState(currentTaskId || tasks?.[0]?.id || '');
  const [sortBy, setSortBy] = useState('order');
  const [filter, setFilter] = useState('all');
  const [cmpMode, setCmpMode] = useState('eq');   // 'eq' | 'lte' | 'gte' (Spec 4.5)
  const [cmpValue, setCmpValue] = useState('');
  const [compareIdx, setCompareIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    if (!selectedTaskId && tasks?.length) setSelectedTaskId(tasks[0].id);
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    if (currentTaskId) setSelectedTaskId(currentTaskId);
  }, [currentTaskId]);

  const selectedTask = useMemo(
    () => tasks.find(t => t.id === selectedTaskId) || tasks[0] || null,
    [tasks, selectedTaskId]
  );

  const orderedStudents = useMemo(() => {
    if (!selectedTask) return [];
    let arr = students.map((s, idx) => ({
      ...s,
      originalIndex: idx,
      points: s.grades?.[selectedTask.id]?.[pointsKey]
    }));

    if (filter === 'zero') arr = arr.filter(s => Number(s.points) === 0);
    else if (filter === 'full') arr = arr.filter(s => Number(s.points) >= Number(selectedTask.maxPoints));
    else if (filter === 'pending') arr = arr.filter(s => s.pending?.includes(selectedTask.id));
    else if (filter === 'ungraded') arr = arr.filter(s => s.points === undefined);
    else if (filter === 'conflict') arr = arr.filter(s => {
      const g = s.grades?.[selectedTask.id];
      return g && g.points !== undefined && g.secondPoints !== undefined && g.points !== g.secondPoints;
    });

    // BE-Vergleich (Exakt / kleiner-gleich / größer-gleich)
    const cmp = parseFloat(String(cmpValue).replace(',', '.'));
    if (!isNaN(cmp)) {
      if (cmpMode === 'eq') arr = arr.filter(s => Number(s.points) === cmp);
      else if (cmpMode === 'lte') arr = arr.filter(s => s.points !== undefined && Number(s.points) <= cmp);
      else if (cmpMode === 'gte') arr = arr.filter(s => s.points !== undefined && Number(s.points) >= cmp);
    }

    if (sortBy === 'points-asc') {
      arr.sort((a, b) => {
        const ap = a.points === undefined ? Infinity : Number(a.points);
        const bp = b.points === undefined ? Infinity : Number(b.points);
        if (ap !== bp) return ap - bp;
        return a.originalIndex - b.originalIndex;
      });
    } else if (sortBy === 'points-desc') {
      arr.sort((a, b) => {
        const ap = a.points === undefined ? -Infinity : Number(a.points);
        const bp = b.points === undefined ? -Infinity : Number(b.points);
        if (ap !== bp) return bp - ap;
        return a.originalIndex - b.originalIndex;
      });
    }

    return arr;
  }, [students, selectedTask, pointsKey, filter, sortBy, cmpMode, cmpValue]);

  useEffect(() => {
    if (!orderedStudents.length) {
      setCompareIdx(0);
      return;
    }
    const pos = orderedStudents.findIndex(s => s.originalIndex === currentStudentIndex);
    setCompareIdx(pos >= 0 ? pos : 0);
  }, [selectedTaskId, sortBy, filter, currentStudentIndex, orderedStudents]);

  useEffect(() => {
    if (compareIdx >= orderedStudents.length && orderedStudents.length > 0) {
      setCompareIdx(orderedStudents.length - 1);
    }
  }, [compareIdx, orderedStudents.length]);

  const selectedEntry = orderedStudents[compareIdx] || null;
  const taskAnnotations = useMemo(() => {
    if (!selectedEntry || !selectedTask) return [];
    return (selectedEntry.annotations?.[selectedTask.id] || []).filter(a => (a?.role || 'first') === activeRole);
  }, [selectedEntry, selectedTask, activeRole]);

  // Erster Ausschnitt der Aufgabe (Override des gewählten Schülers berücksichtigen)
  const firstRegion = selectedTask ? taskRegionsOf(selectedTask)[0] : null;
  const regionRect = (selectedEntry && selectedTask && firstRegion)
    ? (selectedEntry.regionOverrides?.[overrideKeyFor(selectedTask, firstRegion)] || firstRegion.rect)
    : selectedTask?.region;
  const pageRef = (selectedEntry && selectedTask)
    ? (selectedEntry.pages?.[((firstRegion?.page || selectedTask.page || 1)) - 1]
        ?? (selectedEntry.pageStart ? { pdfPage: selectedEntry.pageStart + ((firstRegion?.page || selectedTask.page || 1)) - 1, rotation: 0 } : null))
    : null;
  const pageNumber = pageRef?.pdfPage ?? null;

  const currentLabel = selectedEntry
    ? (selectedEntry.name || `Schüler ${selectedEntry.originalIndex + 1}`)
    : 'Kein Eintrag';

  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[96vw] max-w-[1400px] h-[92vh] max-h-[980px] flex flex-col ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className={`p-4 border-b flex justify-between items-center gap-4 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div>
            <div className="font-semibold text-lg">Aufgabenvergleich</div>
            <p className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Eine Aufgabe visuell durch alle Schülerarbeiten blättern – in Originalreihenfolge oder nach BE sortiert.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onSwitchMode && (
              <div className={`flex rounded-lg overflow-hidden border ${darkMode ? 'border-gray-700' : 'border-gray-300'}`}>
                <button className="px-3 py-1.5 text-sm bg-amber-600 text-white" disabled>Pro Aufgabe</button>
                <button onClick={onSwitchMode} className={`px-3 py-1.5 text-sm ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200'}`}>Pro Schüler</button>
              </div>
            )}
            <button onClick={onClose} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
          </div>
        </div>

        <div className={`p-3 border-b flex flex-wrap gap-2 items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <select
            value={selectedTaskId}
            onChange={e => setSelectedTaskId(e.target.value)}
            className={`px-3 py-2 rounded-lg border text-sm ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}
          >
            {(tasks || []).map(t => (
              <option key={t.id} value={t.id}>{getTaskDisplayName(t, tasks)}</option>
            ))}
          </select>

          <div className="flex gap-1">
            {[['order', 'Original'], ['points-asc', 'Wenigste → meiste BE'], ['points-desc', 'Meiste → wenigste BE']].map(([k, l]) => (
              <button
                key={k}
                onClick={() => setSortBy(k)}
                className={`px-3 py-2 rounded-lg text-sm ${sortBy === k ? 'bg-blue-600 text-white' : darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}
              >
                {l}
              </button>
            ))}
          </div>

          <div className="flex gap-1 ml-auto items-center flex-wrap">
            <div className={`flex items-center gap-1 mr-2 pr-3 border-r ${darkMode ? 'border-gray-700' : 'border-gray-300'}`}>
              {[['eq', '='], ['lte', '≤'], ['gte', '≥']].map(([m, l]) => (
                <button key={m} onClick={() => setCmpMode(m)}
                  className={`w-8 py-2 rounded-lg text-sm font-mono ${cmpMode === m ? 'bg-amber-600 text-white' : darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>{l}</button>
              ))}
              <input type="text" inputMode="decimal" value={cmpValue}
                onChange={e => { const raw = e.target.value.replace('.', ','); if (/^\d{0,3}(,5?)?$/.test(raw)) setCmpValue(raw); }}
                placeholder="BE" className={`w-14 px-2 py-2 text-center rounded-lg border text-sm font-mono ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} />
              {cmpValue !== '' && <button onClick={() => setCmpValue('')} className="p-1 rounded text-gray-400 hover:text-red-400"><X size={14} /></button>}
            </div>
            {[['all', 'Alle'], ['zero', '0 BE'], ['full', 'Volle BE'], ['pending', 'Übersprungen'], ['ungraded', 'Offen'],
              ...(students.some(st => Object.values(st.grades || {}).some(g => g?.secondPoints !== undefined)) ? [['conflict', 'Konflikte']] : [])].map(([k, l]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`px-3 py-2 rounded-lg text-sm ${filter === k ? 'bg-amber-600 text-white' : darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-[300px_1fr]">
          <div className={`border-r flex flex-col min-h-0 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className={`p-3 text-sm flex items-center justify-between ${darkMode ? 'bg-gray-800/70 text-gray-300' : 'bg-gray-50 text-gray-700'}`}>
              <span>{selectedTask ? getTaskDisplayName(selectedTask, tasks) : 'Aufgabe'}</span>
              <span>{orderedStudents.length} Einträge</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {!orderedStudents.length ? (
                <div className={`rounded-xl p-4 text-sm ${darkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-50 text-gray-600'}`}>
                  Keine Schüler in diesem Filter.
                </div>
              ) : orderedStudents.map((entry, idx) => (
                <button
                  key={entry.id}
                  onClick={() => setCompareIdx(idx)}
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${
                    idx === compareIdx
                      ? 'border-amber-500 ring-2 ring-amber-500/30'
                      : darkMode ? 'border-gray-700 hover:border-amber-500' : 'border-gray-200 hover:border-amber-500'
                  } ${darkMode ? 'bg-gray-800' : 'bg-white'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium truncate">{entry.name || `Schüler ${entry.originalIndex + 1}`}</div>
                      <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        #{entry.originalIndex + 1}
                      </div>
                    </div>
                    <div className={`font-bold text-sm ${
                      isBonusScore(entry.points, selectedTask?.maxPoints) ? 'text-fuchsia-500' :
                      Number(entry.points) === Number(selectedTask?.maxPoints) ? 'text-green-500' :
                      Number(entry.points) === 0 ? 'text-red-500' :
                      entry.points !== undefined ? 'text-amber-500' :
                      darkMode ? 'text-gray-500' : 'text-gray-400'
                    }`}>
                      {entry.points !== undefined ? formatBE(entry.points) : '—'}/{formatBE(selectedTask?.maxPoints)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex flex-col">
            <div className={`p-3 border-b flex flex-wrap items-center gap-2 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <button
                onClick={() => setCompareIdx(i => Math.max(0, i - 1))}
                disabled={!orderedStudents.length || compareIdx <= 0}
                className={`p-2 rounded-lg ${darkMode ? 'bg-gray-800 disabled:opacity-40' : 'bg-gray-200 disabled:opacity-40'}`}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => setCompareIdx(i => Math.min(orderedStudents.length - 1, i + 1))}
                disabled={!orderedStudents.length || compareIdx >= orderedStudents.length - 1}
                className={`p-2 rounded-lg ${darkMode ? 'bg-gray-800 disabled:opacity-40' : 'bg-gray-200 disabled:opacity-40'}`}
              >
                <ChevronRight size={18} />
              </button>

              <div className="min-w-0">
                <div className="font-medium truncate">{currentLabel}</div>
                <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {orderedStudents.length ? `${compareIdx + 1} von ${orderedStudents.length}` : '0 von 0'}
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <div className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
                  isBonusScore(selectedEntry?.points, selectedTask?.maxPoints) ? 'bg-fuchsia-500 text-white' :
                  Number(selectedEntry?.points) === Number(selectedTask?.maxPoints) ? 'bg-green-500 text-white' :
                  Number(selectedEntry?.points) === 0 ? 'bg-red-500 text-white' :
                  selectedEntry?.points !== undefined ? 'bg-amber-500 text-white' :
                  darkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-200 text-gray-700'
                }`}>
                  {selectedEntry?.points !== undefined ? formatBE(selectedEntry.points) : '—'}/{formatBE(selectedTask?.maxPoints)} BE
                </div>
                <button onClick={() => setShowFull(v => !v)} className={`px-3 py-2 rounded-lg text-sm ${showFull ? 'bg-blue-600 text-white' : darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                  {showFull ? 'Nur Aufgabe' : 'Ganze Seite'}
                </button>
                <button onClick={() => setZoom(z => Math.max(0.6, z - 0.2))} className={`p-2 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}><ZoomOut size={16} /></button>
                <span className={`text-sm w-12 text-center ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.min(3, z + 0.2))} className={`p-2 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}><ZoomIn size={16} /></button>
                <button
                  onClick={() => {
                    if (!selectedEntry || !selectedTask) return;
                    const taskIndex = tasks.findIndex(t => t.id === selectedTask.id);
                    onOpenSelection?.(selectedEntry.originalIndex, taskIndex >= 0 ? taskIndex : 0);
                    onClose();
                  }}
                  disabled={!selectedEntry || !selectedTask}
                  className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium disabled:opacity-50"
                >
                  In Korrektur öffnen
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-4">
              {!selectedTask || !selectedEntry ? (
                <div className={`h-full rounded-2xl flex items-center justify-center text-sm ${darkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-50 text-gray-600'}`}>
                  Keine Aufgabe / kein Schüler ausgewählt.
                </div>
              ) : pageNumber == null ? (
                <div className={`w-full h-full flex items-center justify-center text-sm ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  Für diesen Schüler fehlt die Seite dieser Aufgabe (Platzhalter).
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-full h-full max-w-[1200px]">
                  <GradingCanvas
                    pdfDoc={pdfDoc}
                    pageNumber={pageNumber}
                    rotation={pageRef?.rotation || 0}
                    scale={zoom}
                    region={regionRect}
                    isCropped={!showFull}
                    annotations={taskAnnotations}
                    onAddAnnotation={() => {}}
                    onDeleteAnnotation={() => {}}
                    activeTool={null}
                    penColor={activeRole === 'second' ? '#22c55e' : '#ef4444'}
                    textColor={activeRole === 'second' ? '#22c55e' : '#ef4444'}
                    textSize={18}
                    textOpacity={1}
                    markSize={30}
                    lineWidth={3}
                    underlineStyle="solid"
                    underlineDouble={false}
                    underlineHook={false}
                    selectedMark={null}
                    darkMode={darkMode}
                    taskPointLabel={{ points: selectedEntry.points, maxPoints: selectedTask.maxPoints }}
                    activeRole={activeRole}
                  />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ==================== Review: Ausschnitt-Thumbnail ====================
const reviewCropCache = new Map(); // key -> dataURL

function ReviewCropThumb({ pdfDoc, student, task, width = 300, darkMode, onClick }) {
  const [src, setSrc] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    (async () => {
      if (!pdfDoc) return;
      // Galerie/Konfliktliste zeigen den ERSTEN Ausschnitt (Override-bewusst)
      const reg = task.regions?.[0] ?? { id: 'r0', page: task.page || 1, rect: task.region };
      const rect = student.regionOverrides?.[`${task.id}::${reg.id}`] || reg.rect;
      if (!rect) return;
      const ref = student.pages?.[(reg.page || 1) - 1]
        ?? (student.pageStart ? { pdfPage: student.pageStart + (reg.page || 1) - 1, rotation: 0 } : null);
      if (!ref || ref.pdfPage == null || ref.pdfPage > pdfDoc.numPages) { setMissing(true); return; }

      const r = rect;
      const isOv = !!student.regionOverrides?.[`${task.id}::${reg.id}`];
      const key = `${ref.pdfPage}@${ref.rotation || 0}@${task.id}@${reg.id}${isOv ? '@ov' : ''}@${r.x.toFixed(1)},${r.y.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}@${width}`;
      if (reviewCropCache.has(key)) { setSrc(reviewCropCache.get(key)); return; }

      try {
        const page = await pdfDoc.getPage(ref.pdfPage);
        const rot = ((page.rotate || 0) + (ref.rotation || 0)) % 360;
        const base = page.getViewport({ scale: 1, rotation: rot });
        const cropW1 = (r.width / 100) * base.width;           // Ausschnittbreite bei Scale 1
        const scale = Math.min((width * 2) / cropW1, 4);       // ~2x Anzeigebreite, gedeckelt
        const vp = page.getViewport({ scale, rotation: rot });

        const temp = document.createElement('canvas');
        temp.width = vp.width; temp.height = vp.height;
        const tctx = temp.getContext('2d');
        tctx.fillStyle = '#fff'; tctx.fillRect(0, 0, temp.width, temp.height);
        await page.render({ canvasContext: tctx, viewport: vp }).promise;

        const cx = (r.x / 100) * vp.width, cy = (r.y / 100) * vp.height;
        const cw = (r.width / 100) * vp.width, ch = (r.height / 100) * vp.height;
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(cw)); out.height = Math.max(1, Math.round(ch));
        out.getContext('2d').drawImage(temp, cx, cy, cw, ch, 0, 0, out.width, out.height);

        const url = out.toDataURL('image/jpeg', 0.8);
        reviewCropCache.set(key, url);
        if (!cancelled) setSrc(url);
      } catch (e) {
        console.error(e);
        if (!cancelled) setMissing(true);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, student, task, width]);

  if (missing) return (
    <div onClick={onClick} className={`flex items-center justify-center text-xs cursor-pointer rounded border-2 border-dashed ${darkMode ? 'border-gray-700 text-gray-500' : 'border-gray-300 text-gray-500'}`}
      style={{ width: '100%', height: 80 }}>
      Seite fehlt
    </div>
  );
  return src
    ? <img src={src} alt="" onClick={onClick} draggable={false} className="block w-full rounded cursor-zoom-in shadow" />
    : <div className={`w-full rounded animate-pulse ${darkMode ? 'bg-gray-800' : 'bg-gray-300'}`} style={{ height: 80 }} />;
}


// ==================== Canvas-Schrift-Helfer (geteilt) ====================
const ensureCanvasFonts = async () => {
  try {
    if (document?.fonts?.load) {
      await Promise.allSettled([
        document.fonts.load('48px "Indie Flower"'),
        document.fonts.load('32px "Indie Flower"'),
      ]);
    }
  } catch {}
};

const fitTextSize = (ctx, text, maxW, maxH, fontFamily, fontWeight = '400') => {
  const padW = maxW * 0.08;
  const padH = maxH * 0.12;
  const targetW = Math.max(10, maxW - padW * 2);
  const targetH = Math.max(10, maxH - padH * 2);

  let size = Math.min(targetH, 220);
  while (size > 10) {
    ctx.font = `${fontWeight} ${size}px "${fontFamily}", cursive`;
    if (ctx.measureText(text).width <= targetW) return size;
    size -= 1;
  }
  return 10;
};

// ==================== Overlay-Zeichnung (geteilt: Export + Review) ====================
// Zeichnet Annotationen, Musterlösung, Aufgaben-Punktelabels und Ergebnisfelder
// auf einen (ggf. transparenten) Canvas. 1:1 aus renderStudentPage herausgelöst.
const drawStudentOverlay = (ctx, canvas, student, pageOffset, scale, opts) => {
  const {
    tasks, scoreFields, taskPointPositions,
    modelSolutions, includeModelSolution, exportModelOpacity,
    maxPts, getStudentTotal, getStudentGrade, pointsKey,
    getTaskPoints = (st, t) => st.grades?.[t.id]?.[pointsKey],
  } = opts;
  // Schritt 9: jede Region wird zur virtuellen Aufgabe (id/page/region passend, Overrides greifen)
  const drawTasks = expandTasksForStudent(tasks, student);
  // Draw annotations
  drawTasks.forEach(task => {
    if (task.page === pageOffset + 1) {
      // Musterlösung zuerst (hinter den Korrekturen)
      if (includeModelSolution && modelSolutions?.[task.id]?.length) {
        const mArr = (modelSolutions[task.id] || []).map(a => ({ ...a, role: MODEL_ROLE }));
        mArr.forEach(a => {
          const c = `rgba(107,114,128,${exportModelOpacity})`;
          if (a.type === 'pen' && a.points) {
            ctx.strokeStyle = c;
            ctx.lineWidth = (a.lineWidth || 2) * 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            a.points.forEach((pt, i) => {
              const x = (task.region.x + pt.x * task.region.width / 100) / 100 * canvas.width;
              const y = (task.region.y + pt.y * task.region.height / 100) / 100 * canvas.height;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.stroke();
          }
          if (a.type === 'mark') {
            const x = (task.region.x + a.x * task.region.width / 100) / 100 * canvas.width;
            const y = (task.region.y + a.y * task.region.height / 100) / 100 * canvas.height;
            const regionH = (task.region.height / 100) * canvas.height;
            const markSize = getAnnotationMarkSizePx(a, regionH, 24);
            drawCanvasMark(ctx, { x, y, symbol: a.symbol, color: c, size: markSize, crossed: !!a.crossed, opacity: (a.opacity ?? 1), stampVariant: getStampVariant(a) });
          }
          if (a.type === 'text') {
            const x = (task.region.x + a.x * task.region.width / 100) / 100 * canvas.width;
            const y = (task.region.y + a.y * task.region.height / 100) / 100 * canvas.height;
            ctx.save();
            const regionH = (task.region.height / 100) * canvas.height;
            const fs = (a.fontSizeRel != null) ? (a.fontSizeRel / 100) * regionH : ((a.fontSize || 16) * scale);
            const yBase = (a.anchor === 'baseline') ? y : (y + fs);
            ctx.globalAlpha = (a.opacity ?? 1);
            ctx.fillStyle = c;
            ctx.font = `${fs}px sans-serif`;
            ctx.fillText(a.text, x, yBase);
            ctx.restore();
          }
          if (a.type === 'underline') {
            const ax = (task.region.x + a.x * task.region.width / 100) / 100 * canvas.width;
            const ay = (task.region.y + a.y * task.region.height / 100) / 100 * canvas.height;
            const aw = (a.width * task.region.width / 100) / 100 * canvas.width;
            const ulw = (a.lineWidth || 2) * 1.2;
            drawCanvasUnderline(ctx, { x: ax, y: ay, width: aw, color: c, lineWidth: ulw, style: a.style, double: !!a.double, hook: !!a.hook });
          }
        });
      }

      const annsAll = (student.annotations?.[task.id] || []).map(normalizeAnnotationRole);
      const anns = role === 'second' ? annsAll.filter(a => (a?.role || 'first') === 'second') : annsAll;
      anns.forEach(a => {
        if (a.type === 'pen' && a.points) {
          ctx.strokeStyle = a.color;
          ctx.lineWidth = (a.lineWidth || 2) * 2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          a.points.forEach((pt, i) => {
            const x = (task.region.x + pt.x * task.region.width / 100) / 100 * canvas.width;
            const y = (task.region.y + pt.y * task.region.height / 100) / 100 * canvas.height;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        }
        if (a.type === 'mark') {
          const x = (task.region.x + a.x * task.region.width / 100) / 100 * canvas.width;
          const y = (task.region.y + a.y * task.region.height / 100) / 100 * canvas.height;
          const regionH = (task.region.height / 100) * canvas.height;
          const markSize = getAnnotationMarkSizePx(a, regionH, 24);
          drawCanvasMark(ctx, { x, y, symbol: a.symbol, color: a.color, size: markSize, crossed: !!a.crossed, opacity: (a.opacity ?? 1), stampVariant: getStampVariant(a) });
        }
        if (a.type === 'text') {
          const x = (task.region.x + a.x * task.region.width / 100) / 100 * canvas.width;
          const y = (task.region.y + a.y * task.region.height / 100) / 100 * canvas.height;
          ctx.save();
          const regionH = (task.region.height / 100) * canvas.height;
          const fs = (a.fontSizeRel != null) ? (a.fontSizeRel / 100) * regionH : ((a.fontSize || 16) * scale);
          const yBase = (a.anchor === 'baseline') ? y : (y + fs);
          ctx.globalAlpha = (a.opacity ?? 1);
          ctx.fillStyle = a.color;
          ctx.font = `${fs}px sans-serif`;
          ctx.fillText(a.text, x, yBase);
          ctx.restore();
        }
        if (a.type === 'underline') {
            const ax = (task.region.x + a.x * task.region.width / 100) / 100 * canvas.width;
            const ay = (task.region.y + a.y * task.region.height / 100) / 100 * canvas.height;
            const aw = (a.width * task.region.width / 100) / 100 * canvas.width;
            const ulw = (a.lineWidth || 2) * 1.2;
            drawCanvasUnderline(ctx, { x: ax, y: ay, width: aw, color: a.color, lineWidth: ulw, style: a.style, double: !!a.double, hook: !!a.hook });
          }
      });
    }
  });
  
  // Draw task-point labels per task on correct page
  drawTasks.forEach(task => {
    if (task.baseId && task.baseId !== task.id) return; // Teil-Ausschnitt: Label nur einmal am ersten Ausschnitt
    if (task.page === pageOffset + 1) {
      const pts = getTaskPoints(student, { id: task.baseId || task.id });
      if (pts !== undefined) {
        let lx, ly;
        if (taskPointPositions[task.id]) {
          lx = (taskPointPositions[task.id].x / 100) * canvas.width;
          ly = (taskPointPositions[task.id].y / 100) * canvas.height;
        } else {
          // Default: top-right of task region
          lx = ((task.region.x + task.region.width) / 100) * canvas.width - 5;
          ly = (task.region.y / 100) * canvas.height + 18;
        }
        const label = `${pts}/${task.maxPoints}`;
        ctx.font = 'bold 16px sans-serif';
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(lx - tw - 8, ly - 14, tw + 12, 20);
        ctx.fillStyle = isBonusScore(pts, task.maxPoints) ? '#c026d3' : pts === task.maxPoints ? '#16a34a' : pts === 0 ? '#dc2626' : '#d97706';
        ctx.textAlign = 'right';
        ctx.fillText(label, lx, ly);
        ctx.textAlign = 'left';
      }
    }
  });
  
  // Draw score on first page
  if (pageOffset === 0) {
    const total = getStudentTotal(student);
    const grade = getStudentGrade(student);
    
    if (scoreFields.totalField) {
      const f = scoreFields.totalField;
      const x = (f.x / 100) * canvas.width;
      const y = (f.y / 100) * canvas.height;
      const w = (f.width / 100) * canvas.width;
      const h = (f.height / 100) * canvas.height;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      const label = `${formatBE(total)} / ${formatBE(maxPts)} BE`;
      ctx.fillStyle = '#dc2626';
      const fs = fitTextSize(ctx, label, w, h, 'Indie Flower', '400');
      ctx.font = `400 ${fs}px "Indie Flower", cursive`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + w / 2, y + h / 2);
      ctx.textAlign = 'left';
    }
    
    if (scoreFields.gradeField) {
      const f = scoreFields.gradeField;
      const x = (f.x / 100) * canvas.width;
      const y = (f.y / 100) * canvas.height;
      const w = (f.width / 100) * canvas.width;
      const h = (f.height / 100) * canvas.height;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = '#dc2626';
      const fs = fitTextSize(ctx, grade, w, h, 'Indie Flower', '400');
      ctx.font = `400 ${fs}px "Indie Flower", cursive`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(grade, x + w / 2, y + h / 2);
      ctx.textAlign = 'left';
    }
    
    if (!scoreFields.totalField && !scoreFields.gradeField) {
      const bx = canvas.width - 260, by = 20, bw = 240, bh = 120;
      ctx.fillStyle = 'rgba(255,255,255,0.97)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 3;
      ctx.strokeRect(bx, by, bw, bh);

      const label = `${formatBE(total)} / ${formatBE(maxPts)} BE`;
      ctx.fillStyle = '#dc2626';
      ctx.font = '400 26px "Indie Flower", cursive';
      ctx.fillText(label, bx + 15, by + 38);

      ctx.fillStyle = '#dc2626';
      ctx.font = '400 54px "Indie Flower", cursive';
      ctx.fillText(grade, bx + 15, by + 102);
    }
  }
  
};

// ==================== Review pro Schüler: Einzelseite ====================
function ReviewStudentPage({ pdfDoc, student, pageOffset, tasks, pointsKey, showAnnotations, overlayOpts, taskRefs, darkMode }) {
  const canvasRef = useRef(null);
  const pageRegions = tasks.flatMap(t => {
    const regs = taskRegionsOf(t);
    return regs
      .map((r, ri) => ({ t, r, ri, multi: regs.length > 1, rect: student.regionOverrides?.[overrideKeyFor(t, r)] || r.rect }))
      .filter(x => x.r.page === pageOffset + 1);
  });

  // Punkte-Signatur, damit das Canvas-Overlay nach Punkteänderungen neu zeichnet
  const gradesSig = tasks.map(t => student.grades?.[t.id]?.[pointsKey] ?? 'x').join('|');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas || !pdfDoc) return;
      const ctx = canvas.getContext('2d');
      const scale = 2;
      const ref = student.pages?.[pageOffset]
        ?? (student.pageStart ? { pdfPage: student.pageStart + pageOffset, rotation: 0 } : null);
      if (!ref) return;

      if (ref.pdfPage == null) {
        canvas.width = 595 * scale; canvas.height = 842 * scale;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#9ca3af'; ctx.font = `${14 * scale}px sans-serif`;
        ctx.fillText('Diese Seite lag beim Scannen nicht vor.', 40 * scale, 60 * scale);
      } else {
        if (ref.pdfPage > pdfDoc.numPages) return;
        const page = await pdfDoc.getPage(ref.pdfPage);
        if (cancelled) return;
        const vp = page.getViewport({ scale, rotation: ((page.rotate || 0) + (ref.rotation || 0)) % 360 });
        canvas.width = vp.width; canvas.height = vp.height;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
      }
      if (cancelled) return;

      if (showAnnotations) {
        await ensureCanvasFonts();
        drawStudentOverlay(ctx, canvas, student, pageOffset, scale, overlayOpts);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, student, pageOffset, showAnnotations, overlayOpts, gradesSig]);

  return (
    <div className="relative">
      <canvas ref={canvasRef} className="block w-full rounded-lg shadow-xl" />
      {pageRegions.map(({ t, r, ri, multi, rect }) => {
        const pts = student.grades?.[t.id]?.[pointsKey];
        return (
          <div key={`${t.id}_${r.id}`} ref={el => { if (taskRefs && ri === 0) taskRefs.current[t.id] = el; }}
            className="absolute border-2 border-amber-500/60 rounded pointer-events-none"
            style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%` }}>
            <span className={`absolute -top-3 left-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${
              pts === t.maxPoints ? 'bg-green-600 text-white'
              : pts === 0 ? 'bg-red-600 text-white'
              : pts !== undefined ? 'bg-amber-600 text-white'
              : 'bg-gray-600 text-white'}`}>
              {t.name}{multi ? ` (${ri + 1})` : ''}: {pts !== undefined ? formatBE(pts) : '—'}/{t.maxPoints}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ==================== Review pro Schüler ====================
function StudentReviewModal({ pdfDoc, students, tasks, gradeTable, pointsKey = 'points', scoreFields, taskPointPositions, modelSolutions, initialStudentIdx = 0, onClose, onSelectStudent, onSetPoints, onSetFinalTotal, onSwitchMode, darkMode }) {
  const [sIdx, setSIdx] = useState(Math.max(0, Math.min(initialStudentIdx, students.length - 1)));
  const [showAnnotations, setShowAnnotations] = useState(true);
  const taskRefs = useRef({});
  const student = students[sIdx];

  const maxPts = tasks.reduce((s, t) => s + t.maxPoints, 0);
  const getTotal = (s) => tasks.reduce((sum, t) => sum + (s.grades?.[t.id]?.[pointsKey] || 0), 0);

  const overlayOpts = useMemo(() => ({
    tasks, scoreFields, taskPointPositions,
    modelSolutions, includeModelSolution: false, exportModelOpacity: defaultModelOpacity,
    maxPts, pointsKey,
    getTaskPoints: (s, t) => s.grades?.[(t.baseId || t.id)]?.[pointsKey],
    getStudentTotal: (s) => tasks.reduce((sum, t) => sum + (s.grades?.[t.id]?.[pointsKey] || 0), 0),
    getStudentGrade: (s) => formatGradeDisplay(
      calculateGrade(tasks.reduce((sum, t) => sum + (s.grades?.[t.id]?.[pointsKey] || 0), 0), maxPts, gradeTable),
      gradeTable
    ),
  }), [tasks, scoreFields, taskPointPositions, modelSolutions, gradeTable, pointsKey, maxPts]);

  const setTaskPoints = (t, raw) => {
    const v = parseFloat(String(raw).replace(',', '.'));
    if (isNaN(v)) return;
    onSetPoints?.(sIdx, Math.max(0, Math.min(Math.round(v * 2) / 2, t.maxPoints)), t.id);
  };

  const scrollToTask = (id) => taskRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); setSIdx(i => Math.min(i + 1, students.length - 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setSIdx(i => Math.max(i - 1, 0)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [students.length]);

  if (!student) return null;
  const nPages = student.pages?.length ?? 1;
  const total = getTotal(student);
  const grade = formatGradeDisplay(calculateGrade(total, maxPts, gradeTable), gradeTable);

  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[980px] h-[88vh] flex flex-col ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        {/* Kopf */}
        <div className={`p-4 border-b flex justify-between items-center gap-3 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <span className="font-semibold">Review:</span>
            <button onClick={() => setSIdx(i => Math.max(i - 1, 0))} disabled={sIdx === 0}
              className={`p-1.5 rounded-lg disabled:opacity-30 ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><ChevronLeft size={18} /></button>
            <select value={sIdx} onChange={e => setSIdx(parseInt(e.target.value, 10))}
              className={`px-3 py-1.5 rounded-lg border text-sm ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`}>
              {students.map((s, i) => <option key={s.id} value={i}>{s.name || `Schüler ${i + 1}`}</option>)}
            </select>
            <button onClick={() => setSIdx(i => Math.min(i + 1, students.length - 1))} disabled={sIdx >= students.length - 1}
              className={`p-1.5 rounded-lg disabled:opacity-30 ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><ChevronRight size={18} /></button>
            <label className="flex items-center gap-2 text-sm ml-3">
              <input type="checkbox" checked={showAnnotations} onChange={e => setShowAnnotations(e.target.checked)} />
              Annotationen anzeigen
            </label>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex rounded-lg overflow-hidden border ${darkMode ? 'border-gray-700' : 'border-gray-300'}`}>
              <button onClick={onSwitchMode} className={`px-3 py-1.5 text-sm ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200'}`}>Pro Aufgabe</button>
              <button className="px-3 py-1.5 text-sm bg-amber-600 text-white">Pro Schüler</button>
            </div>
            <button onClick={() => { onSelectStudent(sIdx); onClose(); }}
              className={`px-3 py-1.5 rounded-lg text-sm ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>
              Zur Korrektur
            </button>
            <button onClick={onClose} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
          </div>
        </div>

        {/* Aufgaben-Sidebar + Seiten */}
        <div className="flex-1 flex overflow-hidden">
          <div className={`w-60 border-r flex flex-col ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex-1 overflow-y-auto p-3">
              {tasks.map(t => {
                const pts = student.grades?.[t.id]?.[pointsKey];
                const pending = student.pending?.includes(t.id);
                return (
                  <div key={t.id} className={`mb-1.5 p-2 rounded-lg flex items-center gap-2 ${darkMode ? 'bg-gray-800/60' : 'bg-gray-100'}`}>
                    <button onClick={() => scrollToTask(t.id)} className="flex-1 text-left text-sm truncate hover:underline" title="Zur Aufgabe springen">
                      {pending && <SkipForward size={11} className="inline text-amber-500 mr-0.5" />}{t.name}
                    </button>
                    {student.grades?.[t.id]?.finalPoints !== undefined && <span className="w-1.5 h-1.5 rounded-full bg-purple-500 flex-shrink-0" title="Final gesetzt" />}
                    <input type="text" inputMode="decimal" value={pts ?? ''} placeholder="—"
                      onChange={e => {
                        const raw = e.target.value.replace('.', ',');
                        if (/^\d{0,3}(,5?)?$/.test(raw)) setTaskPoints(t, raw);
                      }}
                      className={`w-12 px-1 py-1 text-center rounded border text-sm font-mono ${darkMode ? 'bg-gray-800' : 'bg-white'} ${
                        pts === t.maxPoints ? 'border-green-500/60'
                        : pts === 0 ? 'border-red-500/60'
                        : darkMode ? 'border-gray-700' : 'border-gray-300'}`} />
                    <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>/{t.maxPoints}</span>
                  </div>
                );
              })}
            </div>
            {(() => {
              const computedFinal = tasks.reduce((s2, t) => s2 + (getFinalTaskPoints(student, t) || 0), 0);
              const finalTotal = getFinalTotal(student, tasks);
              const finalGrade = formatGradeDisplay(calculateGrade(finalTotal, maxPts, gradeTable), gradeTable);
              const overridden = student.finalTotal !== undefined;
              return (
                <div className={`p-3 border-t text-sm ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                  <div className="flex justify-between"><span>Gesamt ({pointsKey === 'secondPoints' ? 'grün' : 'rot'})</span><span className="font-medium">{formatBE(total)}/{formatBE(maxPts)} BE</span></div>
                  <div className="flex justify-between items-center mt-2">
                    <span>Gesamt (final)</span>
                    <div className="flex items-center gap-1">
                      <input type="text" inputMode="decimal"
                        value={overridden ? String(student.finalTotal).replace('.', ',') : ''}
                        placeholder={formatBE(computedFinal)}
                        title="Leer = Summe der Final-Aufgabenwerte; ein eingetragener Wert überschreibt"
                        onChange={e => {
                          const raw = e.target.value.replace('.', ',');
                          if (raw === '') { onSetFinalTotal?.(sIdx, undefined); return; }
                          if (!/^\d{0,3}(,5?)?$/.test(raw)) return;
                          const v = parseFloat(raw.replace(',', '.'));
                          if (!isNaN(v)) onSetFinalTotal?.(sIdx, Math.max(0, Math.min(Math.round(v * 2) / 2, maxPts)));
                        }}
                        className={`w-16 px-1 py-1 text-center rounded border font-mono ${darkMode ? 'bg-gray-800' : 'bg-white'} ${overridden ? 'border-amber-500' : darkMode ? 'border-gray-700' : 'border-gray-300'}`} />
                      <span>/{formatBE(maxPts)} BE</span>
                    </div>
                  </div>
                  {overridden && Math.abs(student.finalTotal - computedFinal) > 0.001 && (
                    <p className="text-xs text-amber-500 mt-1">
                      Weicht von der Aufgabensumme ({formatBE(computedFinal)}) ab – der überschriebene Wert zählt für Note und Export.
                    </p>
                  )}
                  <div className="flex justify-between mt-2"><span>Note (final)</span><span className="font-bold text-amber-500">{finalGrade}</span></div>
                </div>
              );
            })()}
          </div>

          <div className={`flex-1 overflow-y-auto p-5 ${darkMode ? 'bg-gray-950' : 'bg-gray-200'}`}>
            {Array.from({ length: nPages }, (_, p) => (
              <div key={`${student.id}_${p}`} className="mb-5 max-w-[700px] mx-auto">
                <ReviewStudentPage pdfDoc={pdfDoc} student={student} pageOffset={p} tasks={tasks} pointsKey={pointsKey}
                  showAnnotations={showAnnotations} overlayOpts={overlayOpts} taskRefs={taskRefs} darkMode={darkMode} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ==================== Konfliktliste (rot ≠ grün) ====================
function ConflictModal({ pdfDoc, students, tasks, onSetFinal, onClose, darkMode }) {
  const [onlyOpen, setOnlyOpen] = useState(true);
  useEffect(() => { reviewCropCache.clear(); }, []);

  const conflicts = [];
  students.forEach((s, si) => tasks.forEach(t => {
    const g = s.grades?.[t.id];
    if (hasConflict(g)) conflicts.push({ student: s, studentIdx: si, task: t, g });
  }));
  const open = conflicts.filter(c => c.g.finalPoints === undefined);
  const shown = onlyOpen ? open : conflicts;

  const setAllOpen = (key) => open.forEach(c => onSetFinal(c.studentIdx, c.task.id, c.g[key]));
  const resetAll = () => conflicts.forEach(c => onSetFinal(c.studentIdx, c.task.id, undefined));

  const batchBtn = `px-3 py-1.5 rounded-lg text-sm disabled:opacity-40 ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`;

  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[780px] max-h-[85vh] flex flex-col ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className={`p-4 border-b flex justify-between items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div>
            <h2 className="font-semibold text-lg">Konflikte (rot ≠ grün)</h2>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {conflicts.length} Konflikt(e) • {open.length} offen • {conflicts.length - open.length} entschieden
            </p>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
        </div>

        <div className={`p-3 border-b flex gap-2 flex-wrap items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} />
            nur offene anzeigen
          </label>
          <div className="ml-auto flex gap-2">
            <button onClick={() => setAllOpen('points')} disabled={!open.length} className={batchBtn}>Alle offenen: Final = rot</button>
            <button onClick={() => setAllOpen('secondPoints')} disabled={!open.length} className={batchBtn}>Alle offenen: Final = grün</button>
            <button onClick={resetAll} disabled={conflicts.length === open.length} className={batchBtn}>Alle entfinalisieren</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {shown.length === 0 && (
            <p className={`text-center py-12 text-sm ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              {conflicts.length === 0 ? 'Keine Konflikte – rot und grün stimmen überall überein. 🎉' : 'Alle Konflikte sind entschieden.'}
            </p>
          )}
          {shown.map(c => {
            const { g, task: t, student: s } = c;
            const final = g.finalPoints;
            const resolved = final !== undefined;
            const source = !resolved ? null : final === g.points ? 'rot' : final === g.secondPoints ? 'grün' : 'manuell';
            return (
              <div key={`${s.id}_${t.id}`} className={`mb-3 p-3 rounded-xl border flex gap-4 ${
                resolved
                  ? (darkMode ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-gray-50')
                  : `border-purple-500/50 ${darkMode ? 'bg-purple-900/10' : 'bg-purple-50'}`}`}>
                <div className="w-[240px] flex-shrink-0">
                  <ReviewCropThumb pdfDoc={pdfDoc} student={s} task={t} width={240} darkMode={darkMode} onClick={() => {}} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <p className="font-medium truncate">{s.name || `Schüler ${c.studentIdx + 1}`}</p>
                      <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{t.name} • max. {t.maxPoints} BE</p>
                    </div>
                    {resolved && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 flex-shrink-0">
                        Final: {formatBE(final)} ({source})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <button onClick={() => onSetFinal(c.studentIdx, t.id, g.points)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium ${final === g.points ? 'bg-red-600 text-white' : darkMode ? 'bg-gray-800 hover:bg-gray-700 text-red-400' : 'bg-gray-200 hover:bg-gray-300 text-red-600'}`}>
                      Rot: {formatBE(g.points)}
                    </button>
                    <button onClick={() => onSetFinal(c.studentIdx, t.id, g.secondPoints)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium ${final === g.secondPoints ? 'bg-green-600 text-white' : darkMode ? 'bg-gray-800 hover:bg-gray-700 text-green-400' : 'bg-gray-200 hover:bg-gray-300 text-green-600'}`}>
                      Grün: {formatBE(g.secondPoints)}
                    </button>
                    <input type="text" inputMode="decimal" placeholder="anderer Wert"
                      value={source === 'manuell' ? String(final).replace('.', ',') : ''}
                      onChange={e => {
                        const raw = e.target.value.replace('.', ',');
                        if (!/^\d{0,3}(,5?)?$/.test(raw)) return;
                        const v = parseFloat(raw.replace(',', '.'));
                        if (!isNaN(v)) onSetFinal(c.studentIdx, t.id, Math.max(0, Math.min(Math.round(v * 2) / 2, t.maxPoints)));
                      }}
                      className={`w-24 px-2 py-1.5 text-center rounded-lg border text-sm font-mono ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} />
                    {resolved && (
                      <button onClick={() => onSetFinal(c.studentIdx, t.id, undefined)}
                        className={`px-3 py-1.5 rounded-lg text-sm ${darkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-400' : 'bg-gray-200 hover:bg-gray-300 text-gray-600'}`}>
                        entfinalisieren
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

// ==================== Ausschnitt-Override (pro Schüler) ====================
function RegionOverrideModal({ pdfDoc, pageNumber, task, regionIndex, currentRect, hasOverride, hasAnnotations, onSave, onReset, onClose, darkMode }) {
  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[760px] max-h-[88vh] flex flex-col ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className={`p-4 border-b flex justify-between items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div>
            <h2 className="font-semibold">Ausschnitt anpassen – {task.name} (Ausschnitt {regionIndex + 1})</h2>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Ziehen Sie ein neues Rechteck. Gilt nur für diesen Schüler; das Template bleibt unverändert.
            </p>
            {hasAnnotations && (
              <p className="text-xs text-amber-500 mt-1">
                <AlertTriangle size={12} className="inline mr-1" />
                Vorhandene Markierungen dieses Ausschnitts beziehen sich auf das Rechteck – nach der Anpassung bitte kontrollieren.
              </p>
            )}
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
        </div>
        <div className={`flex-1 overflow-auto p-4 ${darkMode ? 'bg-gray-950' : 'bg-gray-200'}`}>
          <div className="flex justify-center">
            <PDFPageView pdfDoc={pdfDoc} pageNumber={pageNumber} scale={0.9}
              regions={[{ ...currentRect, name: 'aktuell', color: 'amber' }]}
              selectionMode={true}
              onSelect={r => onSave({ x: r.x, y: r.y, width: r.width, height: r.height })} />
          </div>
        </div>
        <div className={`p-4 border-t flex justify-between ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <button onClick={onReset} disabled={!hasOverride}
            className={`px-4 py-2 rounded-xl text-sm disabled:opacity-40 ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>
            Auf Template zurücksetzen
          </button>
          <button onClick={onClose} className={`px-5 py-2 rounded-xl ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>Schließen</button>
        </div>
      </div>
    </Modal>
  );
}

// ==================== Results/Export Modal ====================
function ResultsModal({ project, students, tasks, gradeTable, pdfDoc, pdfArrayBuffer, onClose, onToast, darkMode, vaultPassword }) {
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Diagnose-Filter
  const [diagTaskFilter, setDiagTaskFilter] = useState('all');
  const [diagGroupMode, setDiagGroupMode] = useState('type'); // 'type' | 'competence'

  // Musterlösung-Export
  const [includeModelSolution, setIncludeModelSolution] = useState(false);
  // Kompatibilitätsmodus: rendert jede Seite exakt wie die Bildschirmansicht
  // (pdf.js-Canvas inkl. Markierungen) und bettet sie als Bild ein
  const [rasterExport, setRasterExport] = useState(false);
  // Rückmeldeblatt je Schüler anhängen (Schritt 11)
  const [appendFeedbackSheet, setAppendFeedbackSheet] = useState(false);
  // ZIP-Projektexport (Schritt 10)
  const [showZipExport, setShowZipExport] = useState(false);
  const [showSecondZip, setShowSecondZip] = useState(false);
  const [appendModelPages, setAppendModelPages] = useState(false);
  const [exportModelOpacity, setExportModelOpacity] = useState(project.modelSolutionOpacity ?? defaultModelOpacity);

  const role = project.correctionRole || 'first';
  const pointsKey = role === 'second' ? 'secondPoints' : 'points';
  
  const maxPts = getTasksMaxPoints(tasks);
  const getStudentTotal = (s) => getFinalTotal(s, tasks); // final > rot > grün, Gesamt gedeckelt
  const getStudentGrade = (s) => formatGradeDisplay(calculateGrade(getStudentTotal(s), maxPts, gradeTable), gradeTable);
  const scoreFields = project.scoreFields || {};
  const modelSolutions = project.modelSolutions || {};

  // Verkabelung der geteilten Overlay-Zeichnung (Schritt 6)
  const overlayOpts = {
    tasks, scoreFields, taskPointPositions: project.taskPointPositions || {},
    modelSolutions, includeModelSolution, exportModelOpacity,
    maxPts, getStudentTotal, getStudentGrade, pointsKey,
    getTaskPoints: (st, t) => getFinalTaskPoints(st, { id: t.baseId || t.id }),
  };

  // Kompetenzprofil der Klasse (Final-Werte; nur sichtbar, wenn Aufgaben getaggt sind)
  const classCompetences = useMemo(() => {
    const map = {};
    tasks.forEach(t => {
      if (!t.competence) return;
      const e = map[t.competence] || (map[t.competence] = { got: 0, max: 0 });
      students.forEach(st => { e.got += getFinalTaskPoints(st, t) || 0; });
      e.max += t.maxPoints * students.length;
    });
    return Object.entries(map).map(([name, v]) => ({
      name, pct: v.max ? Math.round((v.got / v.max) * 100) : 0,
    }));
  }, [students, tasks]);

  // ==================== Rückmeldeblatt (Schritt 11, Teil C) ====================
  // Korrekturzeichen zählen – über alle Annotations-Schlüssel (inkl. @@-Ausschnitte), beide Ebenen
  const countMarks = (student) => {
    const counts = {};
    Object.values(student.annotations || {}).forEach(arr => (arr || []).forEach(a => {
      if (a?.type === 'mark' && a.symbol) counts[a.symbol] = (counts[a.symbol] || 0) + 1;
    }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  };

  // Kompetenzprofil eines Schülers (Final-Werte)
  const competenceStats = (student) => {
    const map = {};
    tasks.forEach(t => {
      if (!t.competence) return;
      const e = map[t.competence] || (map[t.competence] = { got: 0, max: 0 });
      e.got += getFinalTaskPoints(student, t) || 0;
      e.max += t.maxPoints;
    });
    return Object.entries(map);
  };

  // A4-Rückmeldeblatt: Ergebnisse, Kriterien, Kompetenzprofil, Fehlerprofil (bewusst ohne Quotient)
  const renderFeedbackSheet = (student) => {
    const scale = 2, W = 595 * scale, H = 842 * scale, M = 48 * scale;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    let y = M + 10 * scale;
    const overflow = () => y > H - M;
    const line = (h = 14) => { y += h * scale; };
    const text = (str, x, o = {}) => {
      ctx.fillStyle = o.color || '#111827';
      ctx.font = `${o.bold ? 'bold ' : ''}${(o.size || 10) * scale}px sans-serif`;
      ctx.fillText(String(str), x, y);
    };
    const bar = (x, wMax, pct, color = '#d97706') => {
      const h = 7 * scale;
      ctx.fillStyle = '#e5e7eb'; ctx.fillRect(x, y - h + 2 * scale, wMax, h);
      ctx.fillStyle = color;
      ctx.fillRect(x, y - h + 2 * scale, Math.max(0, Math.min(1, pct)) * wMax, h);
    };
    const rule = () => {
      ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = scale;
      ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
    };
    const barX = M + 300 * scale, barW = W - M - barX;

    // Kopf
    text(project.title || 'Klassenarbeit', M, { size: 16, bold: true }); line(9);
    text(`Rückmeldung für ${student.name || 'Schüler/in'}`, M, { size: 11, color: '#374151' }); line(14);
    const total = getStudentTotal(student);
    text(`Gesamtergebnis: ${formatBE(total)} / ${formatBE(maxPts)} BE`, M, { size: 11, bold: true });
    text(`Note: ${getStudentGrade(student)}`, M + 280 * scale, { size: 11, bold: true });
    line(8); rule(); line(16);

    // Aufgaben
    text('Ergebnisse je Aufgabe', M, { size: 12, bold: true }); line(14);
    for (const t of tasks) {
      if (overflow()) break;
      const pts = getFinalTaskPoints(student, t) || 0;
      const label = t.competence ? `${getTaskDisplayName(t, tasks)}  (${COMPETENCE_ABBR[t.competence] || t.competence})` : getTaskDisplayName(t, tasks);
      text(label.slice(0, 52), M);
      text(`${formatBE(pts)} / ${formatBE(t.maxPoints)}`, M + 220 * scale);
      bar(barX, barW, t.maxPoints ? pts / t.maxPoints : 0);
      line(13);
      const sel = student.grades?.[t.id]?.rubric || student.grades?.[t.id]?.secondRubric;
      if (t.rubric && sel) {
        for (const c of t.rubric.criteria) {
          if (sel[c.id] === undefined || overflow()) continue;
          const lvl = c.levels.find(l => l.points === sel[c.id]);
          text(`–  ${c.name}: ${formatBE(sel[c.id])} BE${lvl ? ` (${lvl.label})` : ''}`,
            M + 12 * scale, { size: 8.5, color: '#4b5563' });
          line(10);
        }
      }
    }
    line(6);

    // Kompetenzprofil
    const comp = competenceStats(student);
    if (comp.length && !overflow()) {
      text('Kompetenzbereiche', M, { size: 12, bold: true }); line(14);
      for (const [name, v] of comp) {
        if (overflow()) break;
        const pct = v.max ? v.got / v.max : 0;
        text(name, M);
        text(`${Math.round(pct * 100)} %`, M + 220 * scale);
        bar(barX, barW, pct, '#2563eb');
        line(13);
      }
      line(6);
    }

    // Fehlerprofil (ohne Quotient)
    const marks = countMarks(student);
    if (marks.length && !overflow()) {
      text('Häufigste Korrekturzeichen', M, { size: 12, bold: true }); line(14);
      for (const [symbol, n] of marks.slice(0, 6)) {
        if (overflow()) break;
        const def = (project.correctionMarks || []).find(m => m.symbol === symbol);
        text(`${symbol}${def?.name ? ` – ${def.name}` : ''}: ${n}×`, M);
        line(12);
        if (def?.hint && !overflow()) {
          text(`Tipp: ${def.hint}`.slice(0, 100), M + 12 * scale, { size: 8.5, color: '#4b5563' });
          line(11);
        }
      }
    }
    return canvas;
  };

  // Diagnose: Fehlerarten-Auswertung (für die aktuelle Korrekturebene)
  const diagnosticCatalog = project.diagnosticCatalog || [];
  const idToDiag = Object.fromEntries((diagnosticCatalog || []).map(e => [e.id, e]));

  const filteredTasksForDiag = (tasks || []).filter(t => (diagTaskFilter === 'all' ? true : t.id === diagTaskFilter));

  const diagnosticCounts = {};
  (students || []).forEach(s => {
    (filteredTasksForDiag || []).forEach(t => {
      const perTask = s.diagnostics?.[t.id];
      const arr = perTask ? (perTask[role] || []) : [];
      (arr || []).forEach(id => { diagnosticCounts[id] = (diagnosticCounts[id] || 0) + 1; });
    });
  });

  const diagnosticRowsByType = Object.entries(diagnosticCounts)
    .map(([id, count]) => {
      const entry = idToDiag[id] || { id, label: `Unbekannt (${id})`, competence: '' };
      return { ...entry, count };
    })
    .filter(e => e.count > 0)
    .sort((a, b) => b.count - a.count);

  const competenceCounts = {};
  Object.entries(diagnosticCounts).forEach(([id, count]) => {
    const comp = (idToDiag[id]?.competence || '').trim() || 'Ohne Kompetenz';
    competenceCounts[comp] = (competenceCounts[comp] || 0) + count;
  });

  const diagnosticRowsByCompetence = Object.entries(competenceCounts)
    .map(([competence, count]) => ({ id: competence, label: competence, count }))
    .filter(e => e.count > 0)
    .sort((a, b) => b.count - a.count);

  const diagnosticRows = (diagGroupMode === 'competence') ? diagnosticRowsByCompetence : diagnosticRowsByType;


  

  const csvEscape = (v) => {
    const s = (v ?? '').toString();
    if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };

  const downloadDiagnosticCsv = () => {
    try {
      const lines = [];
      const taskName = (diagTaskFilter === 'all') ? 'Alle Aufgaben' : getTaskDisplayName(tasks.find(t => t.id === diagTaskFilter)) || diagTaskFilter;
      lines.push(['Rolle', role, 'Aufgabe', taskName, 'Gruppierung', diagGroupMode === 'competence' ? 'Kompetenz' : 'Fehlerart'].map(csvEscape).join(';'));
      lines.push('');

      if (diagGroupMode === 'competence') {
        lines.push(['Kompetenz', 'Anzahl'].map(csvEscape).join(';'));
        diagnosticRowsByCompetence.forEach(r => {
          lines.push([r.label, r.count].map(csvEscape).join(';'));
        });
      } else {
        lines.push(['Fehlerart', 'Kompetenz', 'Anzahl'].map(csvEscape).join(';'));
        diagnosticRowsByType.forEach(r => {
          lines.push([r.label, r.competence || '', r.count].map(csvEscape).join(';'));
        });
      }

      const csv = lines.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (project?.name || 'capy-note').replace(/[^a-z0-9\-_]+/gi, '_');
      a.href = url;
      a.download = `${safeName}_diagnose_${role}_${diagGroupMode}_${diagTaskFilter}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onToast?.({ type: 'success', message: 'Diagnose-CSV heruntergeladen.' });
    } catch (e) {
      onToast?.({ type: 'error', message: 'CSV-Export fehlgeschlagen.' });
    }
  };


  const totals = students.map(s => getStudentTotal(s));
  const grades = students.map(s => getStudentGrade(s));

  const isPointsSystem = isPointsGradeTable(gradeTable);
  const bestGrade = (() => {
    const valid = grades.filter(g => Number.isFinite(parseFloat(g)));
    if (!valid.length) return '-';
    return valid.reduce((best, g) => {
      const bn = parseFloat(best);
      const gn = parseFloat(g);
      if (!Number.isFinite(bn)) return g;
      if (!Number.isFinite(gn)) return best;
      return isPointsSystem ? (gn > bn ? g : best) : (gn < bn ? g : best);
    }, valid[0]);
  })();
  const avgPoints = totals.length ? (totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1) : 0;
  const gradeCounts = grades.reduce((acc, g) => { acc[g] = (acc[g] || 0) + 1; return acc; }, {});
  
  // Render a single student page to canvas


  const renderStudentPage = async (student, pageOffset, canvasWidth) => {
    if (!pdfDoc) return null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    await ensureCanvasFonts();
    const ref = student.pages?.[pageOffset]
      ?? (student.pageStart ? { pdfPage: student.pageStart + pageOffset, rotation: 0 } : null);
    if (!ref) return null;
    const scale = 2;

    if (ref.pdfPage == null) {
      // Platzhalter: leere Seite mit Hinweis
      canvas.width = 595 * scale; canvas.height = 842 * scale;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#9ca3af'; ctx.font = `${14 * scale}px sans-serif`;
      ctx.fillText('Diese Seite lag beim Scannen nicht vor.', 40 * scale, 60 * scale);
    } else {
      if (ref.pdfPage > pdfDoc.numPages) return null;
      const page = await pdfDoc.getPage(ref.pdfPage);
      const vp = page.getViewport({ scale, rotation: ((page.rotate || 0) + (ref.rotation || 0)) % 360 });
      canvas.width = vp.width;
      canvas.height = vp.height;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    }
    
    drawStudentOverlay(ctx, canvas, student, pageOffset, scale, overlayOpts);
    return canvas;
  };

  // Nur das Overlay (transparent) – für den pdf-lib-Vektor-Export
  const renderOverlayCanvas = async (student, pageOffset, wPx, hPx) => {
    const canvas = document.createElement('canvas');
    canvas.width = wPx; canvas.height = hPx;
    const ctx = canvas.getContext('2d');
    await ensureCanvasFonts();
    // bewusst KEIN weißes fillRect – der Hintergrund bleibt transparent
    drawStudentOverlay(ctx, canvas, student, pageOffset, 2, overlayOpts);
    return canvas;
  };
    // Render a model-solution-only page (base PDF + Musterlösung)
  const renderModelOnlyPage = async (pageOffset) => {
    if (!pdfDoc) return null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    await ensureCanvasFonts();
    const ref = students?.[0]?.pages?.[pageOffset] ?? { pdfPage: 1 + pageOffset, rotation: 0 };
    if (ref.pdfPage == null || ref.pdfPage > pdfDoc.numPages) return null;

    const page = await pdfDoc.getPage(ref.pdfPage);
    const scale = 2;
    const vp = page.getViewport({ scale, rotation: ((page.rotate || 0) + (ref.rotation || 0)) % 360 });
    canvas.width = vp.width;
    canvas.height = vp.height;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    tasks.forEach(task => {
      if (task.page === pageOffset + 1 && modelSolutions?.[task.id]?.length) {
        const mArr = (modelSolutions[task.id] || []).map(a => ({ ...a, role: MODEL_ROLE }));
        mArr.forEach(a => {
          const c = `rgba(107,114,128,${exportModelOpacity})`;
          if (a.type === 'pen' && a.points) {
            ctx.strokeStyle = c;
            ctx.lineWidth = (a.lineWidth || 2) * 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            a.points.forEach((pt, i) => {
              const x = (task.region.x + pt.x * task.region.width / 100) / 100 * canvas.width;
              const y = (task.region.y + pt.y * task.region.height / 100) / 100 * canvas.height;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.stroke();
          }
          if (a.type === 'mark') {
            const x = (task.region.x + a.x * task.region.width / 100) / 100 * canvas.width;
            const y = (task.region.y + a.y * task.region.height / 100) / 100 * canvas.height;
            const regionH = (task.region.height / 100) * canvas.height;
            const markSize = getAnnotationMarkSizePx(a, regionH, 24);
            drawCanvasMark(ctx, { x, y, symbol: a.symbol, color: c, size: markSize, crossed: !!a.crossed, opacity: (a.opacity ?? 1), stampVariant: getStampVariant(a) });
          }
          if (a.type === 'text') {
            const x = (task.region.x + a.x * task.region.width / 100) / 100 * canvas.width;
            const y = (task.region.y + a.y * task.region.height / 100) / 100 * canvas.height;
            ctx.save();
              const regionH = (task.region.height / 100) * canvas.height;
              const fs = (a.fontSizeRel != null) ? (a.fontSizeRel / 100) * regionH : ((a.fontSize || 16) * scale);
              const yBase = (a.anchor === 'baseline') ? y : (y + fs);
              ctx.globalAlpha = (a.opacity ?? 1);
              ctx.fillStyle = c;
              ctx.font = `${fs}px sans-serif`;
              ctx.fillText(a.text, x, yBase);
              ctx.restore();
          }
          if (a.type === 'underline') {
              const ax = (task.region.x + a.x * task.region.width / 100) / 100 * canvas.width;
              const ay = (task.region.y + a.y * task.region.height / 100) / 100 * canvas.height;
              const aw = (a.width * task.region.width / 100) / 100 * canvas.width;
              const ulw = (a.lineWidth || 2) * 1.2;
              drawCanvasUnderline(ctx, { x: ax, y: ay, width: aw, color: c, lineWidth: ulw, style: a.style, double: !!a.double, hook: !!a.hook });
            }
        });
      }
    });

    return canvas;
  };


  // ==================== pdf-lib-Export: Originalseiten + transparentes Overlay ====================
  // Quelle laden; null = Raster-Fallback verwenden (Demo, verschlüsselt, defekt)
  const loadSourceDoc = async () => {
    if (project.isDemo || !pdfArrayBuffer) return null;
    try {
      return await PDFDocument.load(pdfArrayBuffer.slice(0), { ignoreEncryption: true });
    } catch (e) {
      console.warn('pdf-lib konnte das Quell-PDF nicht laden – Raster-Fallback:', e);
      return null;
    }
  };

  // Seiten EINES Schülers in outDoc aufbauen (Originalseiten + transparentes PNG-Overlay)
  const buildStudentPdfPages = async (srcDoc, outDoc, student) => {
    const nPages = student.pages?.length ?? project.pagesPerStudent;
    let helv = null;

    for (let p = 0; p < nPages; p++) {
      const ref = student.pages?.[p]
        ?? (student.pageStart ? { pdfPage: student.pageStart + p, rotation: 0 } : null);
      if (!ref) continue;

      let page;
      if (ref.pdfPage == null) {
        // Platzhalterseite
        page = outDoc.addPage([595, 842]);
        if (!helv) helv = await outDoc.embedFont(StandardFonts.Helvetica);
        page.drawText('Diese Seite lag beim Scannen nicht vor.', {
          x: 40, y: 842 - 60, size: 14, font: helv, color: rgb(0.61, 0.64, 0.69),
        });
      } else {
        if (ref.pdfPage > srcDoc.getPageCount()) continue;
        const [copied] = await outDoc.copyPages(srcDoc, [ref.pdfPage - 1]);
        page = outDoc.addPage(copied);
        const finalRot = ((((copied.getRotation().angle || 0) + (ref.rotation || 0)) % 360) + 360) % 360;
        page.setRotation(degrees(finalRot));
      }

      // Overlay in Anzeige-Orientierung rendern und passend zur Rotation platzieren.
      // WICHTIG: relativ zur CropBox, nicht zur MediaBox – die Bildschirmansicht
      // (pdf.js) arbeitet auf der CropBox; sonst verrutschen Markierungen bei
      // Scanner-PDFs, deren CropBox von der MediaBox abweicht.
      const R = ((page.getRotation().angle || 0) % 360 + 360) % 360;
      const crop = (typeof page.getCropBox === 'function')
        ? page.getCropBox()
        : { x: 0, y: 0, ...page.getSize() };
      const dispW = (R === 90 || R === 270) ? crop.height : crop.width;
      const dispH = (R === 90 || R === 270) ? crop.width : crop.height;

      const overlay = await renderOverlayCanvas(student, p, Math.round(dispW * 2), Math.round(dispH * 2));
      const img = await outDoc.embedPng(await canvasToBytes(overlay, 'image/png'));

      if (R === 90)       page.drawImage(img, { x: crop.x + crop.width, y: crop.y, width: dispW, height: dispH, rotate: degrees(90) });
      else if (R === 180) page.drawImage(img, { x: crop.x + crop.width, y: crop.y + crop.height, width: dispW, height: dispH, rotate: degrees(180) });
      else if (R === 270) page.drawImage(img, { x: crop.x, y: crop.y + crop.height, width: dispW, height: dispH, rotate: degrees(270) });
      else                page.drawImage(img, { x: crop.x, y: crop.y, width: dispW, height: dispH });
    }
  };

  // Raster-Fallback: kompletter Schüler über den Canvas-Renderer (sieht exakt aus wie der Bildschirm)
  const buildStudentRasterPages = async (outDoc, student) => {
    const nPages = student.pages?.length ?? project.pagesPerStudent;
    for (let p = 0; p < nPages; p++) {
      const canvas = await renderStudentPage(student, p);
      if (canvas) await addRasterPage(outDoc, canvas);
    }
  };

  // Vektor versuchen, sonst Raster
  const buildStudentDoc = async (srcDoc, student) => {
    if (srcDoc) {
      try {
        const outDoc = await PDFDocument.create();
        await buildStudentPdfPages(srcDoc, outDoc, student);
        return outDoc;
      } catch (e) {
        console.warn('Vektor-Export fehlgeschlagen – Raster-Fallback:', e);
      }
    }
    const rasterDoc = await PDFDocument.create();
    await buildStudentRasterPages(rasterDoc, student);
    return rasterDoc;
  };

  // Musterlösungs-Extraseiten (bewusst Raster – Beilage, kein Schülerdokument)
  const appendModelPagesTo = async (outDoc) => {
    const nPages = students?.[0]?.pages?.length ?? project.pagesPerStudent;
    for (let p = 0; p < nPages; p++) {
      const canvas = await renderModelOnlyPage(p);
      if (canvas) await addRasterPage(outDoc, canvas);
    }
  };

  // Export single student as PDF
  const exportStudentPdf = async (student, index, srcDocShared) => {
    try {
      const srcDoc = rasterExport ? null
        : (srcDocShared !== undefined ? srcDocShared : await loadSourceDoc());
      const outDoc = await buildStudentDoc(srcDoc, student);
      if (appendFeedbackSheet) await addRasterPage(outDoc, renderFeedbackSheet(student));
      if (appendModelPages) await appendModelPagesTo(outDoc);
      const bytes = await outDoc.save();
      downloadBytes(bytes, `${sanitizeFileName(student.name) || `Schueler_${index + 1}`}.pdf`);
      return true;
    } catch (e) {
      console.error('Export error:', e);
      return false;
    }
  };

  // Export all as combined PDF
  const exportAllPdf = async () => {
    setExporting(true);
    setExportProgress(0);
    try {
      const srcDoc = rasterExport ? null : await loadSourceDoc();
      let finalDoc = null;

      if (srcDoc) {
        try {
          const outDoc = await PDFDocument.create();
          for (let i = 0; i < students.length; i++) {
            setExportProgress(Math.round((i / students.length) * 100));
            await buildStudentPdfPages(srcDoc, outDoc, students[i]);
            if (appendFeedbackSheet) await addRasterPage(outDoc, renderFeedbackSheet(students[i]));
            await new Promise(r => setTimeout(r, 0)); // UI nicht blockieren
          }
          finalDoc = outDoc;
        } catch (e) {
          console.warn('Vektor-Export fehlgeschlagen – Raster-Fallback:', e);
        }
      }

      if (!finalDoc) {
        finalDoc = await PDFDocument.create();
        for (let i = 0; i < students.length; i++) {
          setExportProgress(Math.round((i / students.length) * 100));
          await buildStudentRasterPages(finalDoc, students[i]);
          if (appendFeedbackSheet) await addRasterPage(finalDoc, renderFeedbackSheet(students[i]));
        }
      }

      if (appendModelPages) await appendModelPagesTo(finalDoc);
      downloadBytes(await finalDoc.save(), `${sanitizeFileName(project.title) || 'Klassenarbeit'}_Korrigiert.pdf`);
      setExportProgress(100);
      onToast?.('Sammel-PDF erfolgreich exportiert!', 'success');
    } catch (e) {
      console.error('Export error:', e);
      onToast?.('Export fehlgeschlagen: ' + e.message, 'error');
    }
    setExporting(false);
  };

  const exportIndividualPdfs = async () => {
    setExporting(true);
    const srcDoc = rasterExport ? null : await loadSourceDoc(); // Quelle nur EINMAL laden
    for (let i = 0; i < students.length; i++) {
      setExportProgress(Math.round((i / students.length) * 100));
      await exportStudentPdf(students[i], i, srcDoc);
      await new Promise(r => setTimeout(r, 200));
    }
    setExportProgress(100);
    setExporting(false);
    onToast?.(`${students.length} Einzel-PDFs exportiert!`, 'success');
  };
  
  // Download CSV
  const downloadCsv = () => {
    const headers = ['Nr', 'Name', ...tasks.map(t => t.name), 'Gesamt', 'Prozent', 'Note'];
    const rows = students.map((s, i) => {
      const total = getStudentTotal(s);
      return [
        i + 1,
        s.name || `Schüler ${i + 1}`,
        ...tasks.map(t => getFinalTaskPoints(s, t) ?? ''),
        total,
        maxPts > 0 ? `${((total / maxPts) * 100).toFixed(1)}%` : '',
        getStudentGrade(s)
      ];
    });
    const csv = [headers, ...rows].map(row => row.join(';')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.download = `${project.title}_Ergebnisse.csv`;
    link.href = URL.createObjectURL(blob);
    link.click();
    onToast?.('CSV exportiert!', 'success');
  };

  const downloadJson = (filename, obj) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = filename;
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => { try { URL.revokeObjectURL(link.href); } catch {} }, 5000);
  };

  const exportSecondPackage = async (packagePassword = null) => {
    try {
      if (role !== 'first') return;
      if (!pdfArrayBuffer) throw new Error('PDF-Daten fehlen. Bitte Projekt neu öffnen und erneut versuchen.');
      const includeFirst = !!project.allowSecondViewFirst;

      // sanitize students for package
      const sanitizedStudents = students.map(s => {
        const grades = {};
        (tasks || []).forEach(t => {
          const g = s.grades?.[t.id] || {};
          const out = { ...g };
          if (!includeFirst) { delete out.points; delete out.parts; delete out.rubric; }
          delete out.finalPoints; // Final-Entscheidungen verbleiben beim Erstprojekt
          // Never prefill secondPoints in a fresh package
          delete out.secondPoints;
          delete out.secondParts;
          delete out.secondRubric;
          grades[t.id] = out;
        });

        const annotations = {};
        (tasks || []).forEach(t => {
          annKeysOfTask(s.annotations, t.id).forEach(key => {
            const arr = (s.annotations?.[key] || []).map(normalizeAnnotationRole);
            const filtered = includeFirst ? arr : arr.filter(a => (a?.role || 'first') !== 'first');
            if (filtered.length) annotations[key] = filtered;
          });
        });

        const diagnostics = {};
        (tasks || []).forEach(t => {
          const d = s.diagnostics?.[t.id] || {};
          const firstArr = includeFirst ? (Array.isArray(d.first) ? d.first : (Array.isArray(d) ? d : [])) : [];
          // second correction in a fresh package should always start empty
          const secondArr = [];
          if (firstArr.length || secondArr.length) diagnostics[t.id] = { first: firstArr, second: secondArr };
        });

        return {
          id: s.id,
          name: s.name || '',
          pageStart: s.pageStart,
          pages: s.pages,
          regionOverrides: s.regionOverrides || {},
          grades,
          annotations,
          diagnostics,
          pending: []
        };
      });

      // Altformat (JSON-Paket) abgelöst: Paket wird als .capyz-Projekt exportiert (Spec 4.6)
      await exportProjectAsZip({
        ...project,
        id: `second_${project.id}`,
        sourceProjectId: project.id,
        correctionRole: 'second',
        tasks, gradeTable,
        scoreFields: project.scoreFields || { totalField: null, gradeField: null },
        taskPointPositions: project.taskPointPositions || {},
        modelSolutions: project.modelSolutions || {},
        diagnosticCatalog: project.diagnosticCatalog || [],
        students: sanitizedStudents,
        pdfArrayBuffer,
      }, packagePassword === 'VAULT' ? vaultPassword : packagePassword);
      onToast?.('Zweitkorrektur-Paket (.capyz) exportiert.', 'success');
    } catch (e) {
      console.error(e);
      onToast?.('Export fehlgeschlagen: ' + (e?.message || e), 'error');
    }
  };

  const exportSecondResults = () => {
    try {
      if (role !== 'second') return;
      const sourceProjectId = project.sourceProjectId || project.id;
      const res = {
        type: 'capy-note.second-results.v1',
        appVersion: APP_VERSION,
        exportedAt: new Date().toISOString(),
        sourceProjectId,
        secondProjectId: project.id,
        tasks: (tasks || []).map(t => ({ id: t.id, name: t.name, maxPoints: t.maxPoints })),
        students: students.map(s => {
          const grades = {};
          const finals = {};
          const secondParts = {};
          const secondRubrics = {};
          (tasks || []).forEach(t => {
            const v = s.grades?.[t.id]?.secondPoints;
            if (v !== undefined) grades[t.id] = v;
            const f = s.grades?.[t.id]?.finalPoints;
            if (f !== undefined) finals[t.id] = f;
            const sp = s.grades?.[t.id]?.secondParts;
            if (sp && Object.keys(sp).length) secondParts[t.id] = sp;
            const sr = s.grades?.[t.id]?.secondRubric;
            if (sr && Object.keys(sr).length) secondRubrics[t.id] = sr;
          });
          const annotations = {};
          (tasks || []).forEach(t => {
            annKeysOfTask(s.annotations, t.id).forEach(key => {
              const arr = (s.annotations?.[key] || []).map(normalizeAnnotationRole).filter(a => (a?.role || 'first') === 'second');
              if (arr.length) annotations[key] = arr;
            });
          });
          const out = { id: s.id, name: s.name || '', grades, annotations };
          if (Object.keys(secondParts).length) out.secondParts = secondParts;
          if (Object.keys(secondRubrics).length) out.secondRubrics = secondRubrics;
          if (Object.keys(finals).length) out.finals = finals;
          if (s.finalTotal !== undefined) out.finalTotal = s.finalTotal;
          return out;
        }),
      };
      const safeTitle = (sanitizeFileName(project.title) || 'Projekt').replace(/\s+/g, '_');
      downloadJson(`${safeTitle}_Zweitkorrektur_Ergebnis.json`, res);
      onToast?.('Zweitkorrektur-Ergebnis exportiert.', 'success');
    } catch (e) {
      console.error(e);
      onToast?.('Export fehlgeschlagen: ' + (e?.message || e), 'error');
    }
  };


  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[850px] max-h-[85vh] flex flex-col ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className={`p-4 border-b flex justify-between items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex items-center gap-3">
            <Award className="text-amber-500" size={24} />
            <div>
              <h2 className="font-semibold text-lg">Ergebnisse & Export</h2>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{project.title}</p>
            </div>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
        </div>
        
        {classCompetences.length > 0 && (
          <div className={`p-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <p className="font-semibold text-sm mb-2">Kompetenzbereiche (Klassenmittel, final)</p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2">
              {classCompetences.map(c => (
                <div key={c.name} className="flex items-center gap-2 text-sm">
                  <span className="w-52 truncate" title={c.name}>{c.name}</span>
                  <div className={`flex-1 h-2 rounded ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                    <div className="h-2 rounded bg-amber-600" style={{ width: `${c.pct}%` }} />
                  </div>
                  <span className="w-12 text-right">{c.pct} %</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {(() => {
          let open = 0;
          students.forEach(st => tasks.forEach(t => {
            const g = st.grades?.[t.id];
            if (hasConflict(g) && g.finalPoints === undefined) open++;
          }));
          return open > 0 ? (
            <div className={`px-4 py-2.5 border-b flex items-center gap-2 text-sm ${darkMode ? 'border-gray-700 bg-violet-900/20 text-violet-300' : 'border-gray-200 bg-violet-50 text-violet-700'}`}>
              <AlertTriangle size={15} />
              {open} Konflikt{open === 1 ? '' : 'e'} (rot ≠ grün) ohne Final-Entscheidung – es zählt die Erstkorrektur. Konfliktliste über das Warn-Symbol in der Kopfzeile.
            </div>
          ) : null;
        })()}
        {showZipExport && (
          <ExportZipDialog vaultUnlocked={!!vaultPassword} darkMode={darkMode}
            onClose={() => setShowZipExport(false)}
            onExport={async sel => {
              try {
                const pw = sel === 'VAULT' ? vaultPassword : sel;
                await exportProjectAsZip({
                  ...project, students, tasks, gradeTable,
                  scoreFields: project.scoreFields || {}, taskPointPositions: project.taskPointPositions || {},
                  modelSolutions: project.modelSolutions || {}, pdfArrayBuffer,
                }, pw);
                setShowZipExport(false);
                onToast?.('Projekt als .capyz exportiert.', 'success');
              } catch (e) { console.error(e); onToast?.('Export fehlgeschlagen: ' + (e?.message || e), 'error'); }
            }} />
        )}
        {showSecondZip && (
          <ExportZipDialog title="Zweitkorrektur-Paket exportieren" vaultUnlocked={!!vaultPassword} darkMode={darkMode}
            onClose={() => setShowSecondZip(false)}
            onExport={async sel => {
              setShowSecondZip(false);
              await exportSecondPackage(sel);
            }} />
        )}
        {/* Statistics */}
        <div className={`p-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="grid grid-cols-4 gap-4">
            <div className={`p-4 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
              <div className={`flex items-center gap-2 mb-1 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}><Users size={16} />Schüler</div>
              <div className="text-2xl font-bold">{students.length}</div>
            </div>
            <div className={`p-4 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
              <div className={`flex items-center gap-2 mb-1 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}><BarChart3 size={16} />Ø Punkte</div>
              <div className="text-2xl font-bold">{avgPoints} <span className="text-sm text-gray-500">/ {maxPts}</span></div>
            </div>
            <div className={`p-4 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
              <div className={`flex items-center gap-2 mb-1 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}><Award size={16} />Beste Note</div>
              <div className="text-2xl font-bold text-green-500">{bestGrade}</div>
            </div>
            <div className={`p-4 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
              <div className={`flex items-center gap-2 mb-1 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}><Award size={16} />Ø Note</div>
              <div className="text-2xl font-bold text-amber-500">
                {grades.length ? (grades.reduce((a, g) => a + (parseFloat(g) || 0), 0) / grades.length).toFixed(1) : '-'}
              </div>
            </div>
          </div>
          
          <div className="mt-4 flex gap-2 flex-wrap">
            {Object.entries(gradeCounts).sort((a, b) => a[0].localeCompare(b[0])).map(([grade, count]) => (
              <div key={grade} className={`px-3 py-1 rounded-full text-sm ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                Note {grade}: <span className="font-bold">{count}×</span>
              </div>
            ))}
          </div>
        </div>
        

        {/* Diagnose (Fehlerarten) */}
        {diagnosticCatalog.length > 0 && (
          <div className={`p-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="font-semibold flex items-center gap-2"><BarChart3 size={18} />Diagnose: häufige {diagGroupMode === 'competence' ? 'Kompetenzen' : 'Fehlerarten'}</h3>
                <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Aus den während der Korrektur markierten Fehlerarten (nur aktuelle Ebene: {role === 'second' ? 'Zweitkorrektur' : 'Erstkorrektur'}).</p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <select value={diagTaskFilter} onChange={e => setDiagTaskFilter(e.target.value)} className={`px-3 py-2 rounded-lg border text-sm ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`}>
                  <option value="all">Alle Aufgaben</option>
                  {(tasks || []).map(t => (
                    <option key={t.id} value={t.id}>{getTaskDisplayName(t)}</option>
                  ))}
                </select>

                <select value={diagGroupMode} onChange={e => setDiagGroupMode(e.target.value)} className={`px-3 py-2 rounded-lg border text-sm ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`}>
                  <option value="type">Fehlerarten</option>
                  <option value="competence">Kompetenzen</option>
                </select>

                <button onClick={downloadDiagnosticCsv} disabled={diagnosticRows.length === 0} className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>
                  <Download size={16} /> CSV
                </button>
              </div>
            </div>

            {diagnosticRows.length === 0 ? (
              <p className={`mt-3 text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Noch keine Fehlerarten markiert.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {diagnosticRows.slice(0, 24).map(e => (
                  <div key={e.id} className={`px-3 py-1 rounded-full text-sm ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                    {e.label}
                    {diagGroupMode === 'type' && e.competence ? (
                      <span className={`ml-1 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>({e.competence})</span>
                    ) : null}
                    : <span className="font-bold">{e.count}×</span>
                  </div>
                ))}
                {diagnosticRows.length > 24 && (
                  <div className={`px-3 py-1 rounded-full text-sm ${darkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-200 text-gray-600'}`}>
                    +{diagnosticRows.length - 24} weitere…
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Zweitkorrektur Export/Import */}
        {role === 'first' && (
          <div className={`p-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold">Zweitkorrektur</h3>
                <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Exportiert ein Projektpaket (inkl. PDF) für eine Zweitkorrektur auf einem anderen PC.</p>
              </div>
              <button onClick={() => setShowSecondZip(true)} disabled={exporting} className="py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
                <Archive size={18} /> Paket exportieren
              </button>
            </div>
            {!project.allowSecondViewFirst && (
              <p className={`mt-2 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Hinweis: Die Option „Erstkorrektur darf eingeblendet werden“ ist deaktiviert – das Paket wird blind (ohne rote Ebene) exportiert.</p>
            )}
          </div>
        )}

        {role === 'second' && (
          <div className={`p-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold">Zweitkorrektur-Ergebnis</h3>
                <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Exportiert nur die grüne Ebene (Punkte + Markierungen) zur Übernahme im Erstprojekt.</p>
              </div>
              <button onClick={exportSecondResults} className="py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center gap-2 transition-colors">
                <Download size={18} /> Ergebnis exportieren
              </button>
            </div>
          </div>
        )}


        {/* Musterlösung Export */}
        <div className={`p-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <h3 className="font-semibold">Musterlösung</h3>
              <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Optional: als transparentes Overlay (grau) in den PDF-Export einblenden.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeModelSolution} onChange={e => setIncludeModelSolution(e.target.checked)} />
                Musterlösung in PDF einblenden
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={appendModelPages} onChange={e => setAppendModelPages(e.target.checked)} />
                Musterlösung als Extra-Seiten anhängen
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={appendFeedbackSheet} onChange={e => setAppendFeedbackSheet(e.target.checked)} />
                Rückmeldeblatt je Schüler anhängen
              </label>
              <label className="flex items-center gap-2 text-sm" title="Rendert jede Seite exakt so, wie sie in der Korrekturansicht aussieht, und bettet sie als Bild ein. Größere Datei, dafür garantiert identisches Erscheinungsbild der Markierungen.">
                <input type="checkbox" checked={rasterExport} onChange={e => setRasterExport(e.target.checked)} />
                Kompatibilitätsmodus: exakt wie Bildschirmansicht rastern
              </label>
              <div className="flex items-center gap-3">
                <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Transparenz</span>
                <input type="range" min="0.10" max="0.80" step="0.05" value={exportModelOpacity}
                  onChange={e => setExportModelOpacity(parseFloat(e.target.value))} className="w-40 accent-slate-400" />
                <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>{Math.round(exportModelOpacity*100)}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Export buttons */}
        <div className={`p-4 border-b grid grid-cols-3 gap-3 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <button onClick={downloadCsv} className="py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center gap-2 transition-colors">
            <FileText size={18} /> CSV-Übersicht
          </button>
          <button onClick={exportAllPdf} disabled={exporting} className="py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
            <Download size={18} /> {exporting ? `${exportProgress}%` : 'Sammel-PDF'}
          </button>
          <button onClick={exportIndividualPdfs} disabled={exporting} className="py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
            <Users size={18} /> Einzel-PDFs
          </button>
          <button onClick={() => setShowZipExport(true)} disabled={exporting}
            title="Komplettes Projekt als portable .capyz-Datei sichern (Backup / anderes Gerät)"
            className="py-3 rounded-xl bg-sky-700 hover:bg-sky-600 text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
            <Archive size={18} /> Projekt sichern (ZIP)
          </button>
        </div>
        
        {/* Student list */}
        <div className="flex-1 overflow-y-auto p-4">
          <table className="w-full">
            <thead className={`text-left text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              <tr>
                <th className="pb-2 font-medium">Name</th>
                {tasks.map(t => <th key={t.id} className="pb-2 font-medium text-center">{t.name}</th>)}
                <th className="pb-2 font-medium text-center">Gesamt</th>
                <th className="pb-2 font-medium text-center">Note</th>
                <th className="pb-2 font-medium text-right">PDF</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s, i) => {
                const total = getStudentTotal(s);
                const grade = getStudentGrade(s);
                return (
                  <tr key={s.id} className={`border-t ${darkMode ? 'border-gray-800' : 'border-gray-200'}`}>
                    <td className="py-2">{s.name || `Schüler ${i + 1}`}</td>
                    {tasks.map(t => {
                      const pts = getFinalTaskPoints(s, t);
                      const isFinal = s.grades?.[t.id]?.finalPoints !== undefined;
                      const conflict = hasConflict(s.grades?.[t.id]) && !isFinal;
                      return (
                        <td key={t.id} title={isFinal ? 'Final gesetzt' : conflict ? 'Konflikt rot ≠ grün (Erstkorrektur zählt)' : undefined}
                          className={`py-2 text-center ${isFinal ? 'text-violet-400 font-semibold' : conflict ? 'underline decoration-dotted decoration-violet-500' : isBonusScore(pts, t.maxPoints) ? 'text-fuchsia-500 font-bold' : pts === t.maxPoints ? 'text-green-500' : pts === 0 ? 'text-red-500' : ''}`}>
                          {pts ?? '—'}
                        </td>
                      );
                    })}
                    <td className={`py-2 text-center font-medium ${s.finalTotal !== undefined ? 'text-violet-400' : ''}`} title={s.finalTotal !== undefined ? 'Gesamtsumme manuell überschrieben' : undefined}>{total}/{maxPts}</td>
                    <td className="py-2 text-center font-bold text-amber-500">{grade}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => exportStudentPdf(s, i)} disabled={exporting} className={`p-1.5 rounded disabled:opacity-50 ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}>
                        <Download size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

// ==================== PDF Page Renderer ====================
function PDFPageView({ pdfDoc, pageNumber, scale, regions, selectionMode, onSelect }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState(null);
  const [rect, setRect] = useState(null);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        const vp = page.getViewport({ scale });
        const canvas = canvasRef.current;
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
      } catch (e) { console.error(e); }
    })();
  }, [pdfDoc, pageNumber, scale]);

  const getCoords = (e) => {
    const r = containerRef.current?.getBoundingClientRect();
    if (!r) return null;
    const x = e.touches?.[0]?.clientX ?? e.clientX;
    const y = e.touches?.[0]?.clientY ?? e.clientY;
    return { x: Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100)), y: Math.max(0, Math.min(100, ((y - r.top) / r.height) * 100)) };
  };

  const handleStart = (e) => { if (!selectionMode) return; e.preventDefault(); const c = getCoords(e); if (c) { setDrawing(true); setStart(c); setRect({ x: c.x, y: c.y, width: 0, height: 0 }); } };
  const handleMove = (e) => { if (!drawing || !start) return; const c = getCoords(e); if (c) setRect({ x: Math.min(start.x, c.x), y: Math.min(start.y, c.y), width: Math.abs(c.x - start.x), height: Math.abs(c.y - start.y) }); };
  const handleEnd = () => { if (drawing && rect && rect.width > 2 && rect.height > 2) onSelect?.(rect); setDrawing(false); setStart(null); setRect(null); };

  return (
    <div ref={containerRef} className={`relative inline-block select-none ${selectionMode ? 'cursor-crosshair' : ''}`}
      onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd}
      onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}>
      <canvas ref={canvasRef} className="shadow-xl rounded-lg block" />
      {selectionMode && <div className="absolute inset-0 border-4 border-dashed border-blue-500/50 rounded-lg pointer-events-none animate-pulse" />}
      {regions?.map((r, i) => {
        const colorClass = r.color === 'green'
          ? 'border-green-500 bg-green-500/15'
          : r.color === 'blue'
            ? 'border-sky-500 bg-sky-500/15'
            : 'border-amber-500 bg-amber-500/15';
        const labelClass = r.color === 'green' ? 'bg-green-500' : r.color === 'blue' ? 'bg-sky-500' : 'bg-amber-500';
        return (
          <div key={i} className={`absolute border-2 pointer-events-none ${colorClass}`} style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.width}%`, height: `${r.height}%` }}>
            <span className={`absolute -top-6 left-1 text-white text-xs px-2 py-0.5 rounded whitespace-nowrap ${labelClass}`}>{r.name}</span>
          </div>
        );
      })}
      {rect && rect.width > 0 && (
        <div className="absolute border-2 border-blue-500 bg-blue-500/20 pointer-events-none" style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%` }}>
          <span className="absolute -top-6 left-1 bg-blue-500 text-white text-xs px-2 py-0.5 rounded">{Math.round(rect.width)}% × {Math.round(rect.height)}%</span>
        </div>
      )}
    </div>
  );
}

// ==================== SVG Wavy Line Path Generator ====================
const wavyPath = (x1, y1, x2, y1end, amplitude = 0.4, wavelength = 1.2) => {
  const dx = x2 - x1;
  const steps = Math.max(30, Math.abs(dx) * 4);
  let d = `M ${x1} ${y1}`;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = x1 + dx * t;
    const cy = y1 + Math.sin((t * Math.abs(dx) / wavelength) * Math.PI * 2) * amplitude;
    d += ` L ${cx} ${cy}`;
  }
  return d;
};


function RegionPreview({ pdfDoc, pageNumber, region, darkMode }) {
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pdfDoc || !canvasRef.current || !region) return;
      setLoading(true);
      try {
        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 2 });
        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = viewport.width;
        fullCanvas.height = viewport.height;
        const fullCtx = fullCanvas.getContext('2d');
        await page.render({ canvasContext: fullCtx, viewport }).promise;

        const sx = Math.max(0, Math.floor((region.x / 100) * fullCanvas.width));
        const sy = Math.max(0, Math.floor((region.y / 100) * fullCanvas.height));
        const sw = Math.max(1, Math.floor((region.width / 100) * fullCanvas.width));
        const sh = Math.max(1, Math.floor((region.height / 100) * fullCanvas.height));

        if (cancelled || !canvasRef.current) return;
        const out = canvasRef.current;
        out.width = sw;
        out.height = sh;
        const ctx = out.getContext('2d');
        ctx.clearRect(0, 0, sw, sh);
        ctx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
      } catch (e) {
        console.error('RegionPreview render failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, pageNumber, region]);

  return (
    <div className={`rounded-2xl border overflow-hidden ${darkMode ? 'border-gray-700 bg-gray-950' : 'border-gray-200 bg-gray-50'}`}>
      {loading && <div className={`px-4 py-3 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Namensfeld wird geladen…</div>}
      <canvas ref={canvasRef} className={`block w-full h-auto ${loading ? 'hidden' : ''}`} />
    </div>
  );
}

function NameCaptureModal({ pdfDoc, students, nameField, initialIndex = 0, darkMode, onSaveName, onClose }) {
  const safeIndex = Math.min(Math.max(initialIndex, 0), Math.max(0, students.length - 1));
  const [idx, setIdx] = useState(safeIndex);
  const [value, setValue] = useState(students[safeIndex]?.name || '');
  const inputRef = useRef(null);

  useEffect(() => {
    setValue(students[idx]?.name || '');
  }, [idx, students]);

  useEffect(() => {
    if (!inputRef.current) return;
    const id = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
    return () => clearTimeout(id);
  }, [idx]);

  if (!nameField || !students?.length) return null;

  const currentStudent = students[idx];
  const pageNumber = currentStudent?.pages?.[((nameField.page || 1) - 1)]?.pdfPage
    ?? ((currentStudent?.pageStart || 1) + ((nameField.page || 1) - 1));
  const filledCount = students.filter(s => (s.name || '').trim()).length;
  const remainingCount = students.length - filledCount;

  const persistCurrent = () => onSaveName?.(idx, value);
  const go = (nextIdx, save = true) => {
    if (save) persistCurrent();
    setIdx(Math.min(Math.max(nextIdx, 0), students.length - 1));
  };
  const nextUnnamedIndex = students.findIndex((s, i) => i > idx && !(s.name || '').trim());

  return (
    <Modal onClose={() => { persistCurrent(); onClose?.(); }}>
      <div className={`rounded-2xl w-[min(980px,96vw)] ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className={`p-4 border-b flex justify-between items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div>
            <div className="font-semibold">Namen erfassen</div>
            <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Zuerst nur die Namensfelder transkribieren. Enter speichert und springt direkt weiter.
            </div>
          </div>
          <button onClick={() => { persistCurrent(); onClose?.(); }} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
        </div>

        <div className="grid md:grid-cols-[minmax(0,1fr)_320px] gap-4 p-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="font-medium">Schüler {idx + 1} von {students.length}</div>
              <div className={`text-xs px-2 py-1 rounded-full ${darkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'}`}>
                Erfasst: {filledCount}/{students.length}
              </div>
            </div>
            <RegionPreview pdfDoc={pdfDoc} pageNumber={pageNumber} region={nameField} darkMode={darkMode} />
            <div className={`mt-2 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Seite {nameField.page || 1} des jeweiligen Schülerbogens</div>
          </div>

          <div className={`rounded-2xl border p-4 ${darkMode ? 'border-gray-700 bg-gray-950/60' : 'border-gray-200 bg-gray-50'}`}>
            <div className="font-medium mb-2">{currentStudent?.name?.trim() ? 'Name bearbeiten' : 'Name eingeben'}</div>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (idx < students.length - 1) go(idx + 1, true);
                  else { persistCurrent(); onClose?.(); }
                }
              }}
              placeholder={`Schüler ${idx + 1}`}
              className={`w-full px-4 py-3 rounded-xl border ${darkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-300'}`}
            />

            <div className={`mt-3 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Noch offen: <span className="font-medium">{remainingCount}</span>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <button onClick={() => go(idx - 1, true)} disabled={idx === 0} className={`px-3 py-2 rounded-xl disabled:opacity-40 ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>Zurück</button>
              <button onClick={() => go(idx + 1, true)} disabled={idx >= students.length - 1} className={`px-3 py-2 rounded-xl disabled:opacity-40 ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>Speichern + Weiter</button>
              <button onClick={() => go(idx + 1, false)} disabled={idx >= students.length - 1} className={`px-3 py-2 rounded-xl disabled:opacity-40 ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>Überspringen</button>
              <button onClick={() => {
                persistCurrent();
                if (nextUnnamedIndex >= 0) setIdx(nextUnnamedIndex);
                else onClose?.();
              }} className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white">Nächster ohne Namen</button>
            </div>

            <button onClick={() => { persistCurrent(); onClose?.(); }} className={`w-full mt-4 px-3 py-2 rounded-xl ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>Zur Korrektur</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ==================== Grading Canvas ====================
function GradingCanvas({ pdfDoc, pageNumber, rotation = 0, scale, region, isCropped, annotations, onAddAnnotation, onDeleteAnnotation, activeTool, penColor, textColor, textSize, textOpacity, markSize, lineWidth, underlineStyle, underlineDouble = false, underlineHook = false, selectedMark, darkMode, taskPointLabel, scoreLabels, activeRole = 'first' }) {
  const wrapperRef = useRef(null);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState(null);
  const [textPos, setTextPos] = useState(null);
  const [textDraft, setTextDraft] = useState('');
  const textInputRef = useRef(null);
  const activePointerIdRef = useRef(null);

  const [containerPx, setContainerPx] = useState({ w: 0, h: 0 });

  // SVG uses a square viewBox (0..100 in x/y) that is stretched to the (usually non-square)
  // PDF canvas size. That non-uniform scaling distorts glyphs ("too wide" / "too skinny").
  // Counteract this ONLY for text by applying a horizontal scale factor so glyphs are scaled
  // uniformly (x uses the same pixel scale as y).
  const textAspectFix = (() => {
    const w = containerPx.w || containerRef.current?.getBoundingClientRect().width || 0;
    const h = containerPx.h || containerRef.current?.getBoundingClientRect().height || 0;
    if (!w || !h) return 1;
    const k = h / w; // equals (sy/sx)
    return Number.isFinite(k) && k > 0 ? k : 1;
  })();

  // Track the visible container size reliably. The canvas size changes after PDF render,
  // so a one-time getBoundingClientRect() can be 0 and would blow up SVG font sizes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const r = el.getBoundingClientRect();
      if (!r) return;
      setContainerPx({ w: r.width, h: r.height });
    };

    update();

    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => update());
      ro.observe(el);
    } else {
      window.addEventListener('resize', update);
    }

    return () => {
      try { ro?.disconnect(); } catch { /* ignore */ }
      window.removeEventListener('resize', update);
    };
  }, [pdfDoc, pageNumber, rotation, scale, region, isCropped]);

  // Ensure the text input reliably receives focus in Electron.
  // autoFocus can be flaky when the input mounts during the same pointer event.
  useEffect(() => {
    if (!textPos) return;
    const t = setTimeout(() => {
      try { textInputRef.current?.focus(); } catch { /* ignore */ }
    }, 0);
    return () => clearTimeout(t);
  }, [textPos]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        const canvas = canvasRef.current;
        const wrapper = wrapperRef.current;
        
        if (isCropped && region) {
          const hiRes = 3;
          const vp = page.getViewport({ scale: hiRes, rotation: ((page.rotate || 0) + (rotation || 0)) % 360 });
          const temp = document.createElement('canvas');
          temp.width = vp.width; temp.height = vp.height;
          const tctx = temp.getContext('2d');
          tctx.fillStyle = '#fff';
          tctx.fillRect(0, 0, temp.width, temp.height);
          await page.render({ canvasContext: tctx, viewport: vp }).promise;

          const cx = (region.x / 100) * vp.width, cy = (region.y / 100) * vp.height;
          const cw = (region.width / 100) * vp.width, ch = (region.height / 100) * vp.height;

          const availW = wrapper?.clientWidth || 600;
          const availH = wrapper?.clientHeight || 400;
          const fitScale = Math.min((availW - 40) / (cw / hiRes), (availH - 40) / (ch / hiRes), 2.5) * scale;

          canvas.width = (cw / hiRes) * fitScale;
          canvas.height = (ch / hiRes) * fitScale;
          canvas.getContext('2d').drawImage(temp, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);
        } else {
          // Full-page view should also fit into the available panel space.
          // This keeps the review / comparison view readable and makes the
          // zoom percentage behave like a multiplier on top of the fitted view.
          const baseVp = page.getViewport({ scale: 1, rotation: ((page.rotate || 0) + (rotation || 0)) % 360 });
          const availW = wrapper?.clientWidth || 900;
          const availH = wrapper?.clientHeight || 700;
          const fitScale = Math.min((availW - 40) / baseVp.width, (availH - 40) / baseVp.height, 3) * scale;
          const vp = page.getViewport({ scale: Math.max(0.2, fitScale), rotation: ((page.rotate || 0) + (rotation || 0)) % 360 });
          canvas.width = vp.width;
          canvas.height = vp.height;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
        }
      } catch (e) { console.error(e); }
    })();
  }, [pdfDoc, pageNumber, rotation, scale, region, isCropped]);

  const getCoords = useCallback((e) => {
    const r = containerRef.current?.getBoundingClientRect();
    if (!r) return null;
    const x = e.clientX ?? e.touches?.[0]?.clientX;
    const y = e.clientY ?? e.touches?.[0]?.clientY;
    if (x == null || y == null) return null;
    return { x: ((x - r.left) / r.width) * 100, y: ((y - r.top) / r.height) * 100 };
  }, []);

  // Annotation coordinates are stored "local" to the task region (0–100 inside the crop).
  // In full-page view, we convert between page-% and region-%.
  const toLocalCoords = useCallback((c) => {
    if (!c) return null;
    if (!isCropped && region) {
      const lw = region.width || 0;
      const lh = region.height || 0;
      if (lw <= 0 || lh <= 0) return null;
      const lx = ((c.x - region.x) / lw) * 100;
      const ly = ((c.y - region.y) / lh) * 100;
      if (lx < 0 || lx > 100 || ly < 0 || ly > 100) return null;
      return { x: lx, y: ly };
    }
    return c;
  }, [isCropped, region]);

  const toDisplayCoords = useCallback((c) => {
    if (!c) return null;
    if (!isCropped && region) {
      return {
        x: region.x + (c.x * region.width) / 100,
        y: region.y + (c.y * region.height) / 100
      };
    }
    return c;
  }, [isCropped, region]);

  const relToDisplay = useCallback((rel) => {
    if (rel == null) return rel;
    if (!isCropped && region) return rel * (region.height / 100);
    return rel;
  }, [isCropped, region]);

  const pxToLocalRegionPercent = useCallback((px) => {
    const hRaw = containerPx.h || containerRef.current?.getBoundingClientRect().height || canvasRef.current?.height || 0;
    const h = Math.max(1, hRaw);
    const regionHPx = (!isCropped && region) ? Math.max(1, h * (region.height / 100)) : h;
    return (px / regionHPx) * 100;
  }, [containerPx.h, isCropped, region]);

  const findHitAnnotation = useCallback((p) => {
    if (!p) return null;
    const anns = (annotations || []).filter(a => (a?.role || 'first') === activeRole);
    for (let idx = anns.length - 1; idx >= 0; idx -= 1) {
      const a = anns[idx];
      if (a?.type === 'mark') {
        const localSize = (Number.isFinite(a?.sizeRel) && a.sizeRel > 0) ? a.sizeRel : pxToLocalRegionPercent(Math.max(18, a?.size || markSize || 30));
        const hitRadius = Math.max(localSize * 0.45, pxToLocalRegionPercent(10));
        if (Math.hypot((a.x || 0) - p.x, (a.y || 0) - p.y) <= hitRadius) return a;
        continue;
      }
      if (a?.type === 'underline') {
        const lwLocal = pxToLocalRegionPercent(Math.max(10, (a.lineWidth || 2) * 4));
        const gapLocal = a.double ? pxToLocalRegionPercent(Math.max(2.8, (a.lineWidth || 2) * 1.35)) : 0;
        const ys = a.double ? [(a.y || 0) - gapLocal / 2, (a.y || 0) + gapLocal / 2] : [a.y || 0];
        const x1 = a.x || 0;
        const x2 = x1 + (a.width || 0);
        if (ys.some(yy => pointToSegmentDistance(p.x, p.y, x1, yy, x2, yy) <= lwLocal)) return a;
        if (a.hook) {
          const hookLen = pxToLocalRegionPercent(Math.max(8, (a.lineWidth || 2) * 5));
          const hookY = ys[ys.length - 1];
          const hx2 = x2 - hookLen * 0.28;
          const hy2 = hookY + hookLen * 0.52;
          if (pointToSegmentDistance(p.x, p.y, x2, hookY, hx2, hy2) <= lwLocal) return a;
        }
        continue;
      }
      if (a?.type === 'pen' && Array.isArray(a.points) && a.points.length) {
        const hitDist = pxToLocalRegionPercent(Math.max(8, (a.lineWidth || 2) * 4));
        for (let i = 1; i < a.points.length; i += 1) {
          const p1 = a.points[i - 1];
          const p2 = a.points[i];
          if (pointToSegmentDistance(p.x, p.y, p1.x, p1.y, p2.x, p2.y) <= hitDist) return a;
        }
        const p0 = a.points[0];
        if (Math.hypot((p0?.x || 0) - p.x, (p0?.y || 0) - p.y) <= hitDist) return a;
        continue;
      }
      if (a?.type === 'text') {
        const fs = (Number.isFinite(a?.fontSizeRel) && a.fontSizeRel > 0) ? a.fontSizeRel : pxToLocalRegionPercent(a?.fontSize || 18);
        const width = Math.max(fs * 0.8, ((a.text || '').length || 1) * fs * 0.55);
        const left = a.x || 0;
        const top = (a.anchor === 'baseline') ? ((a.y || 0) - fs) : (a.y || 0);
        if (p.x >= left - fs * 0.2 && p.x <= left + width && p.y >= top - fs * 0.2 && p.y <= top + fs * 1.15) return a;
      }
    }
    return null;
  }, [annotations, activeRole, markSize, pxToLocalRegionPercent]);

  const eraseAtPoint = useCallback((p) => {
    const hit = findHitAnnotation(p);
    if (hit) onDeleteAnnotation?.(hit);
  }, [findHitAnnotation, onDeleteAnnotation]);

  const handleStart = useCallback((e) => {
    if (e.pointerType !== 'pen' && e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation?.();
    if (e.pointerId != null) {
      activePointerIdRef.current = e.pointerId;
      try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    } else {
      activePointerIdRef.current = 'fallback';
    }
    const raw = getCoords(e);
    if (!raw) return;
    const local = toLocalCoords(raw);
    if (!isCropped && region && !local) return;

    if (activeTool === 'pen') {
      setDrawing(true);
      setCurrentStroke({ type: 'pen', color: penColor, points: [local || raw], lineWidth });
    }
    else if (activeTool === 'underline') {
      setDrawing(true);
      const p = (local || raw);
      setCurrentStroke({ type: 'underline', startX: p.x, startY: p.y, endX: p.x, style: underlineStyle, color: penColor, lineWidth, double: underlineDouble, hook: underlineHook });
    }
    else if (activeTool === 'mark' && selectedMark) {
      const p = local || raw;
      const sizeRel = pxToLocalRegionPercent(markSize || 30);
      onAddAnnotation?.({ type: 'mark', x: p.x, y: p.y, symbol: selectedMark.symbol, color: selectedMark.color, role: activeRole, style: selectedMark.style || 'badge', crossed: !!selectedMark.crossed, stampVariant: getStampVariant(selectedMark), size: markSize || 30, sizeRel, opacity: 1 });
    }
    else if (activeTool === 'text') {
      setTextPos(raw);
      setTextDraft('');
    }
    else if (activeTool === 'eraser') {
      eraseAtPoint(local || raw);
    }
  }, [activeTool, penColor, markSize, lineWidth, underlineStyle, underlineDouble, underlineHook, selectedMark, onAddAnnotation, getCoords, toLocalCoords, isCropped, region, activeRole, pxToLocalRegionPercent, eraseAtPoint]);

  const handleMove = useCallback((e) => {
    if (e.pointerId != null && activePointerIdRef.current != null && e.pointerId !== activePointerIdRef.current) return;
    const raw = getCoords(e);
    if (!raw) return;
    const local = toLocalCoords(raw);
    if (!isCropped && region && !local) return;
    const p = local || raw;

    if (activeTool === 'eraser' && activePointerIdRef.current != null) {
      e.preventDefault();
      eraseAtPoint(p);
      return;
    }

    if (!drawing || !currentStroke) return;
    e.preventDefault();
    if (currentStroke.type === 'pen') setCurrentStroke(s => ({ ...s, points: [...s.points, p] }));
    else if (currentStroke.type === 'underline') setCurrentStroke(s => ({ ...s, endX: p.x }));
  }, [drawing, currentStroke, getCoords, toLocalCoords, isCropped, region, activeTool, eraseAtPoint]);

  const handleEnd = useCallback((e) => {
    if (e?.pointerId != null && activePointerIdRef.current != null && e.pointerId !== activePointerIdRef.current) return;
    if (!drawing || !currentStroke) {
      if (e?.pointerId != null) {
        try { e.currentTarget?.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
      }
      activePointerIdRef.current = null;
      return;
    }
    if (currentStroke.type === 'pen' && currentStroke.points.length > 1) onAddAnnotation?.(currentStroke);
    else if (currentStroke.type === 'underline') {
      const w = Math.abs(currentStroke.endX - currentStroke.startX);
      if (w > 2) onAddAnnotation?.({ type: 'underline', x: Math.min(currentStroke.startX, currentStroke.endX), y: currentStroke.startY, width: w, style: currentStroke.style, color: currentStroke.color, lineWidth: currentStroke.lineWidth || 2, double: !!currentStroke.double, hook: !!currentStroke.hook });
    }
    setDrawing(false);
    setCurrentStroke(null);
    if (e?.pointerId != null) {
      try { e.currentTarget?.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    }
    activePointerIdRef.current = null;
  }, [drawing, currentStroke, onAddAnnotation]);

  const submitText = (text) => {
    if (textPos && text.trim()) {
      const local = toLocalCoords(textPos);
      if (local) {
        const fsPx = (textSize ?? 18);
        const hPxRaw = (containerPx.h || containerRef.current?.getBoundingClientRect().height || canvasRef.current?.height || 0);
        const hPx = Math.max(1, hPxRaw);
        const regionHPx = (!isCropped && region) ? Math.max(1, hPx * (region.height / 100)) : hPx;
        const fsRel = (fsPx / regionHPx) * 100; // relative to region height
        onAddAnnotation?.({ type: 'text', x: local.x, y: local.y, text: text.trim(), color: (textColor || penColor), fontSize: fsPx, fontSizeRel: fsRel, opacity: (textOpacity ?? 1), anchor: 'baseline' });
      }
    }
    setTextPos(null);
    setTextDraft('');
  };

  // Render underline SVG path based on style
  const renderUnderlinePath = (a, i, isPreview = false) => {
    let x1 = a.x ?? Math.min(a.startX, a.endX);
    let y = a.y ?? a.startY;
    let w = a.width ?? Math.abs(a.endX - a.startX);

    if (!isCropped && region) {
      x1 = region.x + (x1 * region.width) / 100;
      y = region.y + (y * region.height) / 100;
      w = (w * region.width) / 100;
    }

    const x2 = x1 + w;
    const opacity = isPreview ? 0.6 : 1;
    const lw = (a.lineWidth || 2) * 0.8;
    const containerH = Math.max(1, containerRef.current?.clientHeight || 1);
    const gapPx = a.double ? Math.max(2.8, (a.lineWidth || 2) * 1.35) : 0;
    const gap = (gapPx / containerH) * 100;
    const ys = a.double ? [y - gap / 2, y + gap / 2] : [y];

    const renderOne = (yy, suffix) => {
      if (a.style === 'wavy') {
        return <path key={`u${i}-${suffix}`} d={wavyPath(x1, yy, x2, yy, 0.25 + lw * 0.06, 0.8 + lw * 0.05)} fill="none" stroke={a.color} strokeWidth={lw} opacity={opacity} vectorEffect="non-scaling-stroke" strokeLinecap="round" />;
      }
      const dashProps = {};
      if (a.style === 'dashed') dashProps.strokeDasharray = `${lw * 4} ${lw * 2}`;
      else if (a.style === 'dotted') dashProps.strokeDasharray = `${lw * 0.5} ${lw * 2}`;
      return <line key={`u${i}-${suffix}`} x1={x1} y1={yy} x2={x2} y2={yy} stroke={a.color} strokeWidth={lw} opacity={opacity} vectorEffect="non-scaling-stroke" strokeLinecap="round" {...dashProps} />;
    };

    const hookY = ys[ys.length - 1];
    const hookLen = (Math.max(6, (a.lineWidth || 2) * 3.2) / containerH) * 100;

    return (
      <g key={`ug${i}`}>
        {ys.map((yy, idx) => renderOne(yy, idx))}
        {a.hook && <line x1={x2} y1={hookY} x2={x2 - hookLen * 0.28} y2={hookY + hookLen * 0.52} stroke={a.color} strokeWidth={lw} opacity={opacity} vectorEffect="non-scaling-stroke" strokeLinecap="round" />}
      </g>
    );
  };

  return (
    <div ref={wrapperRef} className="w-full h-full flex items-center justify-center">
      <div
        ref={containerRef}
        className={`relative select-none touch-none ${activeTool ? 'cursor-crosshair' : ''}`}
        style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
        onPointerDown={handleStart}
        onPointerMove={handleMove}
        onPointerUp={handleEnd}
        onPointerCancel={handleEnd}
        onLostPointerCapture={handleEnd}
      >
        <canvas ref={canvasRef} className="shadow-xl rounded-lg block" />

        {!isCropped && region && (
          <div className="absolute border-2 border-amber-500 bg-amber-500/10 pointer-events-none" style={{ left: `${region.x}%`, top: `${region.y}%`, width: `${region.width}%`, height: `${region.height}%` }}>
            <span className="absolute -top-5 left-1 bg-amber-500 text-white text-xs px-1 rounded">{region.name}</span>
          </div>
        )}

        <svg className="absolute inset-0 pointer-events-none overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          {/* Pen strokes */}
          {annotations?.filter(a => a.type === 'pen').map((a, i) => (
            <path
              key={i}
              d={a.points.map((p, j) => {
                const dp = toDisplayCoords(p) || p;
                return `${j === 0 ? 'M' : 'L'} ${dp.x} ${dp.y}`;
              }).join(' ')}
              fill="none"
              stroke={a.color}
              strokeWidth={a.lineWidth || 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {currentStroke?.type === 'pen' && (
            <path
              d={currentStroke.points.map((p, j) => {
                const dp = toDisplayCoords(p) || p;
                return `${j === 0 ? 'M' : 'L'} ${dp.x} ${dp.y}`;
              }).join(' ')}
              fill="none"
              stroke={currentStroke.color}
              strokeWidth={currentStroke.lineWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              opacity={0.7}
            />
          )}
          
          {/* Underlines - all rendered via SVG for consistent wavy support */}
          {annotations?.filter(a => a.type === 'underline').map((a, i) => renderUnderlinePath(a, i))}
          {currentStroke?.type === 'underline' && renderUnderlinePath({
            x: Math.min(currentStroke.startX, currentStroke.endX),
            y: currentStroke.startY,
            width: Math.abs(currentStroke.endX - currentStroke.startX),
            style: currentStroke.style,
            color: currentStroke.color,
            lineWidth: currentStroke.lineWidth,
            double: !!currentStroke.double,
            hook: !!currentStroke.hook
          }, 'preview', true)}

          {/* Text annotations (SVG: baseline-accurate + opacity) */}
          {annotations?.filter(a => a.type === 'text').map((a, i) => {
            const hRaw = containerPx.h || containerRef.current?.getBoundingClientRect().height || canvasRef.current?.height || 0;
            const h = Math.max(1, hRaw);
            let fsRel = (a.fontSizeRel != null) ? a.fontSizeRel : (((a.fontSize || 18) / h) * 100);
            // Guard against invalid values from earlier renders where h was 0.
            if (!Number.isFinite(fsRel) || fsRel <= 0 || fsRel > 20) {
              fsRel = (((a.fontSize || 18) / h) * 100);
            }
            // Backward-compat: older projects stored y as top-left; baseline is ~fontSize lower.
            const baselineLocalY = (a.anchor === 'baseline') ? a.y : (a.y + fsRel);

            const dispPos = toDisplayCoords({ x: a.x, y: baselineLocalY }) || { x: a.x, y: baselineLocalY };
            const xDisp = dispPos.x;
            const yDisp = dispPos.y;
            const fsDisp = relToDisplay(fsRel);

            const fix = textAspectFix;
            const needsFix = Math.abs(fix - 1) > 0.001;
            const transform = needsFix
              ? `translate(${xDisp} ${yDisp}) scale(${fix} 1) translate(${-xDisp} ${-yDisp})`
              : undefined;
            return (
              <text
                key={`t${i}`}
                x={xDisp}
                y={yDisp}
                fill={a.color}
                opacity={a.opacity ?? 1}
                fontSize={fsDisp}
                fontWeight={400}
                dominantBaseline="alphabetic"
                textAnchor="start"
                transform={transform}
              >
                {a.text}
              </text>
            );
          })}

          {/* Text draft preview at the exact cursor baseline */}
          {textPos && (() => {
            const fsPx = (textSize ?? 18);
            const hRaw = containerPx.h || containerRef.current?.getBoundingClientRect().height || canvasRef.current?.height || 0;
            const h = Math.max(1, hRaw);
            const regionHPx = (!isCropped && region) ? Math.max(1, h * (region.height / 100)) : h;
            const fsRelLocal = (fsPx / regionHPx) * 100;
            const fsRel = relToDisplay(fsRelLocal);
            const col = (textColor || penColor);
            const fix = textAspectFix;
            const needsFix = Math.abs(fix - 1) > 0.001;
            const transform = needsFix
              ? `translate(${textPos.x} ${textPos.y}) scale(${fix} 1) translate(${-textPos.x} ${-textPos.y})`
              : undefined;
            return (
              <>
                {/* caret */}
                <line
                  x1={textPos.x}
                  x2={textPos.x}
                  y1={textPos.y - fsRel}
                  y2={textPos.y + fsRel * 0.15}
                  stroke={col}
                  opacity={0.8}
                  style={{ strokeWidth: '1px' }}
                />
                <text
                  x={textPos.x}
                  y={textPos.y}
                  fill={col}
                  opacity={(textOpacity ?? 1)}
                  fontSize={fsRel}
                  fontWeight={400}

                  dominantBaseline="alphabetic"
                  textAnchor="start"
                  transform={transform}
                >
                  {textDraft || ''}
                </text>
              </>
            );
          })()}
        </svg>

        {/* Hidden input for text tool (so the cursor baseline stays exactly at the click position) */}
        {textPos && (
          <input
            ref={textInputRef}
            type="text"
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submitText(textDraft);
              if (e.key === 'Escape') { setTextPos(null); setTextDraft(''); }
            }}
            // Do NOT auto-submit on blur (Electron focus can be flaky).
            onBlur={() => { /* keep open; confirm with Enter */ }}
            autoComplete="off"
            spellCheck={false}
            style={{ position: 'fixed', left: -9999, top: -9999, width: 1, height: 1, opacity: 0 }}
          />
        )}

        {/* Marks */}
        {annotations?.filter(a => a.type === 'mark').map((a, i) => {
          const p = toDisplayCoords({ x: a.x, y: a.y }) || { x: a.x, y: a.y };
          const sizePx = Math.max(12, a.size || 30);
          const isStamp = a.style === 'stamp';
          return (
            <div key={`m${i}`} className="absolute pointer-events-none" style={{ left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%, -50%)' }}>
              {isStamp ? (
                <StampPreview mark={a} size={sizePx} />
              ) : (
                <div className="font-bold px-1 rounded" style={{ backgroundColor: `${a.color}25`, color: a.color, border: `1.5px solid ${a.color}50` }}>{a.symbol}</div>
              )}
            </div>
          );
        })}
        {/* Task point label at top-right of cropped region */}
        {taskPointLabel && isCropped && (
          <div className="absolute top-2 right-2 pointer-events-none">
            <div className={`px-2.5 py-1 rounded-lg text-sm font-bold shadow-lg ${
              isBonusScore(taskPointLabel.points, taskPointLabel.maxPoints) ? 'bg-fuchsia-500 text-white' :
              taskPointLabel.points === taskPointLabel.maxPoints ? 'bg-green-500 text-white' :
              taskPointLabel.points === 0 ? 'bg-red-500 text-white' :
              taskPointLabel.points !== undefined ? 'bg-amber-500 text-white' :
              darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'
            }`}>
              {taskPointLabel.points !== undefined ? taskPointLabel.points : '—'}/{taskPointLabel.maxPoints} BE
            </div>
          </div>
        )}
        {/* Task point label at region corner in full-page view */}
        {taskPointLabel && !isCropped && region && (
          <div className="absolute pointer-events-none" style={{ left: `${region.x + region.width}%`, top: `${region.y}%`, transform: 'translate(-100%, 0)' }}>
            <div className={`px-2 py-0.5 rounded text-xs font-bold shadow ${
              isBonusScore(taskPointLabel.points, taskPointLabel.maxPoints) ? 'bg-fuchsia-500 text-white' :
              taskPointLabel.points === taskPointLabel.maxPoints ? 'bg-green-500 text-white' :
              taskPointLabel.points === 0 ? 'bg-red-500 text-white' :
              taskPointLabel.points !== undefined ? 'bg-amber-500 text-white' :
              darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'
            }`}>
              {taskPointLabel.points !== undefined ? taskPointLabel.points : '—'}/{taskPointLabel.maxPoints}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Annotation Toolbar ====================
function AnnotationToolbar({ activeTool, setActiveTool, penColor, setPenColor, textColor, setTextColor, textSize, setTextSize, textOpacity, setTextOpacity, markSize, setMarkSize, lineWidth, setLineWidth, underlineStyle, setUnderlineStyle, underlineDouble, setUnderlineDouble, underlineHook, setUnderlineHook, correctionMarks, selectedMark, setSelectedMark, onUndo, canUndo, darkMode, onEditMarks, onEditUnderlines }) {
  const [showSize, setShowSize] = useState(false);
  const [showTextStyle, setShowTextStyle] = useState(false);

  const textPresetColors = [
    { id: 'red', value: '#ef4444', name: 'Rot' },
    { id: 'green', value: '#22c55e', name: 'Grün' },
    { id: 'blue', value: '#3b82f6', name: 'Blau' },
    { id: 'black', value: '#111827', name: 'Schwarz' },
    { id: 'gray', value: '#6b7280', name: 'Grau' },
  ];
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const dragRef = useRef(null); // { startX, startY, origLeft, origTop }
  const barRef = useRef(null);
  const initializedRef = useRef(false);

  const clampToViewport = useCallback((left, top) => {
    const bar = barRef.current;
    const rect = bar?.getBoundingClientRect();
    const bw = rect?.width ?? 360;
    const bh = rect?.height ?? 56;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const maxLeft = Math.max(margin, vw - bw - margin);
    const maxTop = Math.max(margin, vh - bh - margin);
    return {
      left: Math.max(margin, Math.min(maxLeft, left)),
      top: Math.max(margin, Math.min(maxTop, top)),
    };
  }, []);

  const computeDefaultPos = useCallback(() => {
    const bar = barRef.current;
    const rect = bar?.getBoundingClientRect();
    const bw = rect?.width ?? 360;
    const top = 96; // below header
    const left = Math.round((window.innerWidth - bw) / 2);
    return clampToViewport(left, top);
  }, [clampToViewport]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    // Wait one frame so the toolbar is measured
    requestAnimationFrame(() => {
      setPos(computeDefaultPos());
    });
  }, [computeDefaultPos]);

  useEffect(() => {
    const onResize = () => setPos(p => clampToViewport(p.left, p.top));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampToViewport]);

  // When switching tools, collapse any open popovers so the UI doesn't feel "stuck".
  useEffect(() => {
    if (activeTool !== 'text') setShowTextStyle(false);
    // showSize is relevant for pen/underline/marks; close it when leaving those.
    if (activeTool !== 'pen' && activeTool !== 'underline' && activeTool !== 'mark') setShowSize(false);
  }, [activeTool]);

  // Close popovers on outside click/tap.
  useEffect(() => {
    const onDown = (e) => {
      const bar = barRef.current;
      if (!bar) return;
      if (bar.contains(e.target)) return;
      setShowTextStyle(false);
      setShowSize(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  const handleDragStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cx = e.touches?.[0]?.clientX ?? e.clientX;
    const cy = e.touches?.[0]?.clientY ?? e.clientY;
    dragRef.current = { startX: cx, startY: cy, origLeft: pos.left, origTop: pos.top };

    const handleMove = (ev) => {
      if (!dragRef.current) return;
      ev.preventDefault?.();
      const mx = ev.touches?.[0]?.clientX ?? ev.clientX;
      const my = ev.touches?.[0]?.clientY ?? ev.clientY;
      const newLeft = dragRef.current.origLeft + (mx - dragRef.current.startX);
      const newTop = dragRef.current.origTop + (my - dragRef.current.startY);
      setPos(clampToViewport(newLeft, newTop));
    };
    const handleUp = () => {
      dragRef.current = null;
      setPos(p => clampToViewport(p.left, p.top));
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleUp);
  };

  const resetPosition = () => setPos(computeDefaultPos());

  // Toggle: clicking an already active tool deactivates it
  const toggle = (tool, extra) => {
    if (activeTool === tool && !extra) { setActiveTool(null); return; }
    setActiveTool(tool);
  };

  return (
    <div
      ref={barRef}
      className={`fixed z-40 flex items-center gap-1 p-2 rounded-xl select-none ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}
      style={{ left: `${pos.left}px`, top: `${pos.top}px`, touchAction: 'none' }}
    >
      {/* Drag handle */}
      <div
        className={`cursor-grab active:cursor-grabbing px-1 mr-1 flex flex-col gap-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        onDoubleClick={resetPosition}
        title="Ziehen zum Verschieben • Doppelklick zum Zurücksetzen"
      >
        <div className="flex gap-0.5"><div className="w-1 h-1 rounded-full bg-current" /><div className="w-1 h-1 rounded-full bg-current" /></div>
        <div className="flex gap-0.5"><div className="w-1 h-1 rounded-full bg-current" /><div className="w-1 h-1 rounded-full bg-current" /></div>
        <div className="flex gap-0.5"><div className="w-1 h-1 rounded-full bg-current" /><div className="w-1 h-1 rounded-full bg-current" /></div>
      </div>

      <div className={`flex gap-1 pr-2 border-r ${darkMode ? 'border-gray-600' : 'border-gray-300'}`}>
        <button onClick={() => { toggle('pen', penColor !== '#ef4444'); setPenColor('#ef4444'); }} title="Rotstift" className={`p-2 rounded-lg transition-colors ${activeTool === 'pen' && penColor === '#ef4444' ? 'bg-red-500/30 ring-2 ring-red-500' : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}><PenTool size={18} className="text-red-500" /></button>
        <button onClick={() => { toggle('pen', penColor !== '#22c55e'); setPenColor('#22c55e'); }} title="Grünstift" className={`p-2 rounded-lg transition-colors ${activeTool === 'pen' && penColor === '#22c55e' ? 'bg-green-500/30 ring-2 ring-green-500' : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}><PenTool size={18} className="text-green-500" /></button>
        <div className="relative">
          <button onClick={() => setShowSize(!showSize)} title="Stift-, Unterstreichungs- und Stempelgröße" className={`p-2 rounded-lg ${showSize ? (darkMode ? 'bg-gray-700' : 'bg-gray-300') : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}><Circle size={16} /></button>
          {showSize && (
            <div className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 p-3 rounded-xl shadow-xl z-50 whitespace-nowrap ${darkMode ? 'bg-gray-700 border border-gray-600' : 'bg-white border border-gray-200'}`}>
              <div className="text-xs text-gray-400 mb-1.5">Werkzeuggröße</div>
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-gray-400 mb-1">Stift & Unterstreichungen</div>
                  <div className="flex items-center gap-2">
                    <input type="range" min="1" max="8" value={lineWidth} onChange={e => setLineWidth(+e.target.value)} className="w-24 accent-amber-500" />
                    <span className="text-sm font-mono w-6 text-right">{lineWidth}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    <svg width="80" height="16" viewBox="0 0 80 16"><line x1="4" y1="8" x2="76" y2="8" stroke={penColor} strokeWidth={lineWidth * 0.8} strokeLinecap="round" /></svg>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">Stempel</div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setMarkSize(v => Math.max(14, v - 4))} className={`px-2 py-1 rounded ${darkMode ? 'bg-gray-800 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'}`}>−</button>
                    <input type="range" min="14" max="72" step="2" value={markSize} onChange={e => setMarkSize(+e.target.value)} className="w-24 accent-amber-500" />
                    <button type="button" onClick={() => setMarkSize(v => Math.min(72, v + 4))} className={`px-2 py-1 rounded ${darkMode ? 'bg-gray-800 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'}`}>+</button>
                    <span className="text-sm font-mono w-8 text-right">{markSize}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <StampPreview mark={selectedMark || { style: 'stamp', stampVariant: 'check', color: '#ef4444', symbol: '✓' }} size={markSize} />
                    <span className="text-[11px] text-gray-400">gilt für neu gesetzte Stempel</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={`flex gap-1 px-2 border-r ${darkMode ? 'border-gray-600' : 'border-gray-300'}`}>
        <button onClick={() => toggle('eraser')} title="Radierer" className={`p-2 rounded-lg transition-colors ${activeTool === 'eraser' ? 'bg-gray-600 ring-2 ring-gray-400' : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}><Eraser size={18} /></button>
      </div>

      <div className={`flex gap-1 px-2 border-r ${darkMode ? 'border-gray-600' : 'border-gray-300'}`}>
        {underlineStyles.map(s => (
          <button key={s.id} onClick={() => { if (activeTool === 'underline' && underlineStyle === s.id) { setActiveTool(null); } else { setActiveTool('underline'); setUnderlineStyle(s.id); } }} title={s.name} className={`px-2 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeTool === 'underline' && underlineStyle === s.id ? 'bg-amber-500/30 ring-2 ring-amber-500 text-amber-500' : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}>
            {s.label}
          </button>
        ))}
        <button onClick={() => { setActiveTool('underline'); setUnderlineDouble(false); }} title="Einfach unterstreichen (1 Fehler)" className={`px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeTool === 'underline' && !underlineDouble ? 'bg-amber-500/30 ring-2 ring-amber-500 text-amber-500' : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}>1×</button>
        <button onClick={() => { setActiveTool('underline'); setUnderlineDouble(true); }} title="Doppelt unterstreichen (2 Fehler)" className={`px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeTool === 'underline' && underlineDouble ? 'bg-amber-500/30 ring-2 ring-amber-500 text-amber-500' : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}>2×</button>
        <button onClick={() => { setActiveTool('underline'); setUnderlineHook(v => !v); }} title="Häkchen rechts (0,5 bzw. 1,5 Fehler)" className={`px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeTool === 'underline' && underlineHook ? 'bg-amber-500/30 ring-2 ring-amber-500 text-amber-500' : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}>
          <svg width="24" height="14" viewBox="0 0 24 14" className="inline-block align-middle">
            <line x1="2" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            <line x1="21" y1="6" x2="18.8" y2="10.2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
        <button onClick={onEditUnderlines} title="Bereits gezeichnete Linien bearbeiten" className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-300 text-gray-700'}`}>
          <Settings size={15} />
        </button>
      </div>

      <div className={`flex gap-1 px-2 border-r ${darkMode ? 'border-gray-600' : 'border-gray-300'}`}>
        {[...(correctionMarks || [])].sort((a, b) => Number(isRequiredCorrectionMark(b)) - Number(isRequiredCorrectionMark(a))).slice(0, 8).map(m => (
          <button
            key={m.id}
            onClick={() => { if (activeTool === 'mark' && selectedMark?.id === m.id) { setActiveTool(null); } else { setActiveTool('mark'); setSelectedMark(m); } }}
            title={m.name}
            className={`relative px-1.5 py-1 rounded text-xs font-bold transition-colors ${activeTool === 'mark' && selectedMark?.id === m.id ? 'ring-2' : ''}`}
            style={{ backgroundColor: m.style === 'stamp' ? 'transparent' : `${m.color}25`, color: m.color, borderColor: activeTool === 'mark' && selectedMark?.id === m.id ? m.color : 'transparent' }}
          >
            {m.style === 'stamp' ? (
              <StampPreview mark={m} size={16} />
            ) : (
              m.symbol
            )}
          </button>
        ))}
        <button
          onClick={onEditMarks}
          title="Korrekturzeichenpalette anpassen"
          className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-300 text-gray-700'}`}
        >
          <Settings size={16} />
        </button>
      </div>

      <button onClick={() => toggle('text')} title="Text einfügen" className={`p-2 rounded-lg transition-colors ${activeTool === 'text' ? 'bg-blue-500/30 ring-2 ring-blue-500' : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}><Type size={18} /></button>
      <div className="relative">
        <button
          onClick={() => { setActiveTool('text'); setShowTextStyle(v => !v); }}
          title="Text: Farbe, Größe & Transparenz"
          className={`p-2 rounded-lg ${showTextStyle ? (darkMode ? 'bg-gray-700' : 'bg-gray-300') : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}
        >
          <AlignCenterVertical size={18} />
        </button>
        {showTextStyle && (
          <div className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 p-3 rounded-xl shadow-xl z-50 w-64 ${darkMode ? 'bg-gray-700 border border-gray-600' : 'bg-white border border-gray-200'}`}>
            <div className="text-xs text-gray-400 mb-1.5">Text</div>

            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Farbe</span>
              <div className="flex items-center gap-1">
                {textPresetColors.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    title={c.name}
                    onClick={() => setTextColor(c.value)}
                    className={`w-5 h-5 rounded-full border ${textColor === c.value ? 'ring-2 ring-amber-500' : ''} ${darkMode ? 'border-gray-500' : 'border-gray-300'}`}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
                <input
                  type="color"
                  value={textColor}
                  onChange={e => setTextColor(e.target.value)}
                  title="Freie Farbauswahl"
                  className="w-7 h-7 p-0 bg-transparent border-0"
                />
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Größe</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="10"
                  max="40"
                  value={textSize}
                  onChange={e => setTextSize(+e.target.value)}
                  className="w-28 accent-amber-500"
                />
                <span className="text-sm font-mono w-8 text-right">{textSize}</span>
              </div>
            </div>

                        <div className="mt-3 flex items-center justify-between gap-2">
              <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Transparenz</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={textOpacity}
                  onChange={e => setTextOpacity(parseFloat(e.target.value))}
                  className="w-28 accent-amber-500"
                />
                <span className="text-sm font-mono w-10 text-right">{Math.round(textOpacity * 100)}%</span>
              </div>
            </div>

            <div className={`mt-3 px-2 py-2 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}
              style={{ color: textColor, fontSize: `${textSize}px`, lineHeight: 1.1, opacity: textOpacity }}
            >
              Aa Beispieltext
            </div>
          </div>
        )}
      </div>
      <button onClick={onUndo} disabled={!canUndo} title="Rückgängig" className={`p-2 rounded-lg disabled:opacity-30 ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}><Undo2 size={18} /></button>
    </div>
  );
}
// ==================== Splash ====================
function SplashScreen({ onFinish }) {
  useEffect(() => { const t = setTimeout(onFinish, 1200); return () => clearTimeout(t); }, [onFinish]);
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-900 via-orange-800 to-amber-900 flex flex-col">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center animate-fade-in">
          <div className="mb-4 flex justify-center"><CapyLogo size={120} /></div>
          <h1 className="text-5xl font-bold text-white"><span className="text-amber-300">Capy</span>-note</h1>
          <p className="text-amber-200/80 mt-2">Korrektur leicht gemacht</p>
        </div>
      </div>
      <Footer darkMode={true} />
    </div>
  );
}

// ==================== Dashboard ====================
function Dashboard({ darkMode, setDarkMode, projects, onNew, onOpen, onDelete, onImport, onVault, vaultUnlocked }) {
  const [del, setDel] = useState(null);
  const [expiredProjects, setExpiredProjects] = useState([]);
  const importRef = useRef(null);
  const [toast, setToast] = useState(null);
  
  // Check for expired projects on mount
  useEffect(() => {
    const expired = projects.filter(p => p.deleteDate && new Date(p.deleteDate) <= new Date());
    if (expired.length > 0) setExpiredProjects(expired);
  }, [projects]);
  
  return (
    <div className={`min-h-screen flex flex-col ${darkMode ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-900'}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <input ref={importRef} type="file" accept=".capyz,application/json,.json" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { const res = await onImport?.(f); if (res) setToast(res); } catch (err) { console.error(err); setToast({ message: err?.message || 'Import fehlgeschlagen', type: 'error' }); } }} />
      {/* Expired projects reminder */}
      {expiredProjects.length > 0 && (
        <Modal onClose={() => setExpiredProjects([])}>
          <div className={`p-6 rounded-2xl w-[450px] ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
            <div className="flex items-center gap-3 mb-4">
              <Clock className="text-amber-500" size={24} />
              <h3 className="font-semibold text-lg">Projekte zum Löschen fällig</h3>
            </div>
            <p className={`mb-4 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Die folgenden Projekte haben ihr Löschdatum erreicht:
            </p>
            {expiredProjects.map(p => (
              <div key={p.id} className={`p-3 rounded-lg mb-2 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                <div className="flex justify-between items-center">
                  <span className="font-medium">{p.title}</span>
                  <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Fällig: {new Date(p.deleteDate).toLocaleDateString('de-DE')}</span>
                </div>
              </div>
            ))}
            <div className="flex gap-3 mt-4">
              <button onClick={() => setExpiredProjects([])} className={`flex-1 py-2.5 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Später</button>
              <button onClick={() => { expiredProjects.forEach(p => onDelete(p.id)); setExpiredProjects([]); }} className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-medium">Alle löschen</button>
            </div>
          </div>
        </Modal>
      )}
      
      {del && (
        <Modal onClose={() => setDel(null)}>
          <div className={`p-6 rounded-2xl w-[400px] ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
            <h3 className="font-semibold mb-2">Projekt löschen?</h3>
            <p className={`mb-6 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{del.title}</p>
            <div className="flex gap-3">
              <button onClick={() => setDel(null)} className={`flex-1 py-2 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Abbrechen</button>
              <button onClick={() => { onDelete(del.id); setDel(null); }} className="flex-1 py-2 bg-red-600 text-white rounded-xl font-medium">Löschen</button>
            </div>
          </div>
        </Modal>
      )}
      <header className={`border-b sticky top-0 z-40 backdrop-blur-sm ${darkMode ? 'border-gray-800 bg-gray-900/95' : 'border-gray-200 bg-white/95'}`}>
        <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <CapyLogo size={40} />
            <h1 className="text-xl font-bold"><span className="text-amber-500">Capy</span>-note</h1>
          </div>
          <div className="flex gap-3">
            <button onClick={() => importRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"><FileUp size={20} /> Import</button>
            <button onClick={onVault} title="Tresor: sitzungsweiter Schlüssel für verschlüsselte ZIP-Exporte/-Importe"
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${vaultUnlocked ? 'bg-emerald-700 hover:bg-emerald-600 text-white' : darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>
              Tresor{vaultUnlocked ? ' ✓' : ''}
            </button>
            <button onClick={() => setDarkMode(!darkMode)} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`}>{darkMode ? <Sun size={20} /> : <Moon size={20} />}</button>
            <button onClick={onNew} className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors"><Plus size={20} /> Neue Korrektur</button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-4xl mx-auto px-6 py-8 w-full">
        {projects.length === 0 ? (
          <div className={`text-center py-16 rounded-2xl border-2 border-dashed ${darkMode ? 'border-gray-700' : 'border-gray-300'}`}>
            <div className="mb-4 flex justify-center"><CapyLogo size={80} /></div>
            <h2 className="text-xl font-semibold mb-2">Willkommen bei Capy-note!</h2>
            <p className={`mb-6 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Starten Sie Ihre erste Korrektur</p>
            <button onClick={onNew} className="px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg inline-flex items-center gap-2 transition-colors"><FileUp size={20} /> PDF hochladen</button>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map(p => (
              <div key={p.id} className={`p-5 rounded-xl border transition-colors ${darkMode ? 'border-gray-800 bg-gray-900 hover:border-gray-700' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                <div className="flex justify-between">
                  <div className="flex-1 cursor-pointer" onClick={() => onOpen(p)}>
                    <h3 className="font-semibold text-lg hover:text-amber-500 transition-colors">{p.title}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>{p.subject} • {p.level} • {p.studentCount} Schüler</span>
                      {p.deleteDate && (
                        <span className="text-xs text-amber-500 flex items-center gap-1"><Clock size={12} />Löschen: {new Date(p.deleteDate).toLocaleDateString('de-DE')}</span>
                      )}
                    </div>
                    {/* Progress bar */}
                    <div className={`mt-3 h-2 rounded-full overflow-hidden ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                      <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${p.progress || 0}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-4 ml-4">
                    <span className="text-2xl font-bold text-amber-500">{p.progress || 0}%</span>
                    <button onClick={e => { e.stopPropagation(); setDel(p); }} className={`p-2 rounded ${darkMode ? 'hover:bg-red-500/20 text-gray-500' : 'hover:bg-red-100 text-gray-400'} hover:text-red-400`}><Trash2 size={18} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer darkMode={darkMode} />
    </div>
  );
}

// ==================== Setup ====================
function SetupWizard({ darkMode, onBack, onComplete }) {
  const [step, setStep] = useState(1);
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfArrayBuffer, setPdfArrayBuffer] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('Französisch');
  const [level, setLevel] = useState('');
  const [pagesPerStudent, setPagesPerStudent] = useState(2);
  const [gradeTable, setGradeTable] = useState(normalizeGradeTable(defaultGradeTableSekI));
  const [correctionMarks, setCorrectionMarks] = useState([...defaultCorrectionMarks]);
  const [tasks, setTasks] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectionMode, setSelectionMode] = useState(null);
  const [pendingRegion, setPendingRegion] = useState(null);
  const [isDemo, setIsDemo] = useState(false);
  const [zoom, setZoom] = useState(0.9);
  const [showGradeEditor, setShowGradeEditor] = useState(false);
  const [showMarksEditor, setShowMarksEditor] = useState(false);
  const [showUnderlineEditor, setShowUnderlineEditor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scoreFields, setScoreFields] = useState({ totalField: null, gradeField: null });
  const [nameField, setNameField] = useState(null);
  const [allowSecondViewFirst, setAllowSecondViewFirst] = useState(false);
  const [toast, setToast] = useState(null);
  const fileRef = useRef(null);

  const studentCount = Math.ceil(pageCount / pagesPerStudent);

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      const lib = await loadPdfJs();
      const ab = await file.arrayBuffer();
      const pdf = await lib.getDocument({ data: ab.slice(0) }).promise;
      setPdfFile(file); setPdfDoc(pdf); setPdfArrayBuffer(ab); setPageCount(pdf.numPages);
      setTitle(file.name.replace('.pdf', '').replace(/[_-]/g, ' '));
      setStep(2);
    } catch (e) {
      console.error(e);
      const useDemo = false;
      setToast({ message: 'PDF konnte nicht geladen werden. Bitte Datei prüfen.', type: 'error' });
      if (useDemo) startDemo();
    } finally { setLoading(false); }
  };

  const startDemo = () => {
    const demo = createDemoPdf(8);
    setIsDemo(true);
    setPdfFile({ name: 'Demo.pdf' }); setPdfDoc(demo); setPdfArrayBuffer(null); setPageCount(8); setTitle('Demo-Klassenarbeit'); setStep(2);
  };

  const saveTask = (data) => {
    const id = `t_${Date.now()}`;
    const rect = { x: pendingRegion.x, y: pendingRegion.y, width: pendingRegion.width, height: pendingRegion.height };
    setTasks([...tasks, { id, ...data, page: pendingRegion.page, region: rect, regions: [{ id: 'r0', page: pendingRegion.page, rect }] }]);
    setPendingRegion(null);
  };

  // ==================== Multi-Ausschnitte (Schritt 9) ====================
  const [regionTarget, setRegionTarget] = useState(null);
  const updateRegions = (taskId, fn) => setTasks(ts => ts.map(t => t.id === taskId
    ? syncLegacyTaskFields({ ...t, regions: fn(taskRegionsOf(t).map(r => ({ ...r }))) }) : t));
  const moveRegion = (taskId, ri, dir) => updateRegions(taskId, regs => {
    const ni = ri + dir; if (ni < 0 || ni >= regs.length) return regs;
    [regs[ri], regs[ni]] = [regs[ni], regs[ri]]; return regs;
  });
  const removeRegion = (taskId, rId) => updateRegions(taskId, regs => regs.filter(r => r.id !== rId));

  const finish = async () => {
    if (!tasks.length) return alert('Bitte mindestens eine Aufgabe definieren.');
    const sourcePdfSha256 = pdfArrayBuffer ? await sha256Hex(pdfArrayBuffer) : null;
    const students = Array.from({ length: studentCount }, (_, i) => {
      const start = i * pagesPerStudent + 1;
      return {
        id: `s_${i}`, name: '',
        pageStart: start, // Kompatibilität
        pages: Array.from({ length: pagesPerStudent }, (_, k) => start + k)
          .filter(p => p <= pageCount)
          .map(p => ({ pdfPage: p, rotation: 0 })),
        grades: {}, annotations: {}, diagnostics: {}, pending: [],
      };
    });
    onComplete({ 
      title, subject, level, gradeTable, correctionMarks, pagesPerStudent, 
      pdfName: pdfFile.name, pageCount, studentCount, tasks, students, 
      pdfArrayBuffer, scoreFields, nameField, allowSecondViewFirst, isDemo, sourcePdfSha256,
      diagnosticCatalog: [],
      modelSolutions: {}, modelSolutionOpacity: defaultModelOpacity,
      resumeTask: 0, resumeStudent: 0 
    });
  };

  if (step === 1) return (
    <div className={`min-h-screen flex flex-col ${darkMode ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-900'}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <header className={`border-b ${darkMode ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={onBack} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`}><ChevronLeft size={20} /></button>
          <div>
            <h1 className="text-xl font-semibold">Neue Korrektur</h1>
            <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Schritt 1 von 3: PDF hochladen</p>
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-12 flex-1 w-full">
        <div onClick={() => !loading && fileRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
          className={`p-16 rounded-2xl border-2 border-dashed text-center cursor-pointer transition-colors ${darkMode ? 'border-gray-700 hover:border-amber-500' : 'border-gray-300 hover:border-amber-500'}`}>
          <input ref={fileRef} type="file" accept=".pdf" onChange={e => handleFile(e.target.files[0])} className="hidden" />
          {loading ? <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" /> : (
            <React.Fragment><FileUp size={64} className="mx-auto mb-4 text-gray-400" /><p className="text-xl font-medium">PDF auswählen oder hierhin ziehen</p><p className={`text-sm mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Gescanntes Klassen-PDF mit allen Schülerarbeiten</p></React.Fragment>
          )}
        </div>
        <div className="mt-6 text-center">
          <button onClick={startDemo} className={`px-6 py-3 rounded-xl ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'} transition-colors`}>🎮 Demo-Modus</button>
        </div>
      </main>
      <Footer darkMode={darkMode} />
    </div>
  );

  if (step === 2) return (
    <div className={`min-h-screen flex flex-col ${darkMode ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-900'}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {showGradeEditor && <GradeTableEditor gradeTable={gradeTable} onChange={setGradeTable} onClose={() => setShowGradeEditor(false)} maxPts={tasks.reduce((a, t) => a + (Number(t.maxPoints) || 0), 0)} darkMode={darkMode} />}
      {showMarksEditor && <CorrectionMarksEditor marks={correctionMarks} onChange={setCorrectionMarks} onClose={() => setShowMarksEditor(false)} darkMode={darkMode} />}
      <header className={`border-b ${darkMode ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => setStep(1)} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`}><ChevronLeft size={20} /></button>
          <div>
            <h1 className="text-xl font-semibold">Einstellungen</h1>
            <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Schritt 2 von 3: Projekt konfigurieren</p>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto px-6 py-8 w-full">
        <div className={`p-4 rounded-xl mb-6 flex items-center gap-3 ${darkMode ? 'bg-green-900/30 border border-green-700' : 'bg-green-50 border border-green-300'}`}>
          <Check className="text-green-500" /><div><p className="font-medium">{pdfFile.name}</p><p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>{pageCount} Seiten</p></div>
        </div>
        <div className={`p-6 rounded-xl border mb-6 space-y-4 ${darkMode ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
          <div><label className="block text-sm mb-1 font-medium">Titel</label><input type="text" value={title} onChange={e => setTitle(e.target.value)} className={`w-full px-4 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm mb-1 font-medium">Fach</label><select value={subject} onChange={e => setSubject(e.target.value)} className={`w-full px-4 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`}>
              {['Französisch', 'Englisch', 'Deutsch', 'Mathematik', 'Latein', 'Spanisch', 'Sonstiges'].map(f => <option key={f}>{f}</option>)}
            </select></div>
            <div><label className="block text-sm mb-1 font-medium">Klasse</label><input type="text" value={level} onChange={e => setLevel(e.target.value)} placeholder="z.B. 9a" className={`w-full px-4 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} /></div>
          </div>
          <div><label className="block text-sm mb-1 font-medium">Seiten pro Schüler</label><select value={pagesPerStudent} onChange={e => setPagesPerStudent(+e.target.value)} className={`w-full px-4 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`}>
            {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} {n === 1 ? 'Seite' : 'Seiten'}</option>)}
          </select></div>
          <div className={`p-3 rounded-lg ${darkMode ? 'bg-amber-900/30 border border-amber-700' : 'bg-amber-50 border border-amber-300'}`}>
            <p className="text-amber-600 font-medium">{pageCount} Seiten ÷ {pagesPerStudent} Seiten/Schüler = <strong>{studentCount} Schüler</strong></p>
            {pageCount % pagesPerStudent !== 0 && <p className="text-amber-500 text-sm mt-1">⚠ Nicht gleichmäßig teilbar – bitte Seitenanzahl überprüfen</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-6">
          <button onClick={() => setShowGradeEditor(true)} className={`p-4 rounded-xl border text-left transition-colors ${darkMode ? 'border-gray-800 bg-gray-900 hover:border-gray-700' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
            <Table className="text-amber-500 mb-2" /><p className="font-medium">Bewertungstabelle</p><p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>{(gradeTable.rows || []).length} Stufen</p>
          </button>
          <button onClick={() => setShowMarksEditor(true)} className={`p-4 rounded-xl border text-left transition-colors ${darkMode ? 'border-gray-800 bg-gray-900 hover:border-gray-700' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
            <Type className="text-amber-500 mb-2" /><p className="font-medium">Korrekturzeichen</p><p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>{correctionMarks.length} Zeichen</p>
          </button>
        </div>
        <div className={`p-6 rounded-xl border mb-6 ${darkMode ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
          <h3 className="font-semibold mb-2">Zweitkorrektur (optional)</h3>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={allowSecondViewFirst} onChange={e => setAllowSecondViewFirst(e.target.checked)} className="mt-1" />
            <div>
              <p className="font-medium">Erstkorrektur darf vom Zweitprüfer eingeblendet werden</p>
              <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Wenn deaktiviert, wird das Paket für die Zweitkorrektur ohne rote Ebene exportiert (blind).</p>
            </div>
          </label>
        </div>
        <div className="flex justify-between">
          <button onClick={() => setStep(1)} className={`px-6 py-2 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Zurück</button>
          <button onClick={() => setStep(3)} disabled={!title || !level} className="px-6 py-2 bg-amber-600 text-white rounded-xl disabled:opacity-50 font-medium">Weiter</button>
        </div>
      </main>
      <Footer darkMode={darkMode} />
    </div>
  );

  return (
    <div className={`min-h-screen flex flex-col ${darkMode ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-900'}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {pendingRegion && pendingRegion.type === 'task' && <TaskDialog count={tasks.length} onSave={saveTask} onCancel={() => setPendingRegion(null)} darkMode={darkMode} />}
      <header className={`border-b flex-shrink-0 ${darkMode ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
        <div className="px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button onClick={() => setStep(2)} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`}><ChevronLeft size={20} /></button>
            <div>
              <h1 className="text-xl font-semibold">Aufgaben & Felder definieren</h1>
              <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Schritt 3 von 3: Markieren Sie Bereiche auf Seite 1-{pagesPerStudent} eines Schülers</p>
            </div>
          </div>
          <button onClick={finish} disabled={!tasks.length} className="px-6 py-2 bg-amber-600 text-white rounded-xl disabled:opacity-50 font-medium">
            {nameField ? 'Korrektur starten & Namen erfassen' : 'Korrektur starten'} ({tasks.length} {tasks.length === 1 ? 'Aufgabe' : 'Aufgaben'})
          </button>
        </div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <div className={`w-72 border-r overflow-y-auto p-4 ${darkMode ? 'border-gray-800 bg-gray-900/50' : 'border-gray-200 bg-white'}`}>
          <div className="mb-6">
            <div className="flex justify-between items-center mb-3">
              <span className="font-medium">Aufgaben</span>
              <button onClick={() => { setSelectionMode('task'); }} disabled={selectionMode}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${selectionMode === 'task' ? 'bg-blue-600 text-white' : 'bg-amber-600 text-white'} disabled:opacity-50`}>
                <Crop size={14} className="inline mr-1" />Markieren
              </button>
            </div>
            {selectionMode === 'task' && <div className={`p-3 mb-3 rounded-lg text-sm ${darkMode ? 'bg-blue-900/30 border border-blue-700 text-blue-400' : 'bg-blue-100 border border-blue-300 text-blue-700'}`}>👆 Ziehen Sie ein Rechteck über den Aufgabenbereich</div>}
            {selectionMode === 'taskRegion' && <div className={`p-3 mb-3 rounded-lg text-sm ${darkMode ? 'bg-blue-900/30 border border-blue-700 text-blue-400' : 'bg-blue-100 border border-blue-300 text-blue-700'}`}>👆 Ziehen Sie den zusätzlichen Ausschnitt (Blattseite ggf. oben wechseln)</div>}
            {tasks.length === 0 && !selectionMode && (
              <div className={`p-4 rounded-lg text-sm text-center ${darkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                Noch keine Aufgaben definiert. Klicken Sie „Markieren" und ziehen Sie einen Bereich auf dem PDF.
              </div>
            )}
            {tasks.map((t, i) => (
              <div key={t.id} className={`p-3 rounded-lg border mb-2 ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
                <div className="flex justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{t.name}</p>
                    <div className="flex flex-wrap gap-1 mt-1 items-center">
                      {taskRegionsOf(t).map((r, ri) => (
                        <span key={r.id} className={`flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded text-[11px] ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                          #{ri + 1} S.{r.page}
                          <button onClick={() => moveRegion(t.id, ri, -1)} disabled={ri === 0} className="px-0.5 disabled:opacity-20">‹</button>
                          <button onClick={() => moveRegion(t.id, ri, 1)} disabled={ri === taskRegionsOf(t).length - 1} className="px-0.5 disabled:opacity-20">›</button>
                          {taskRegionsOf(t).length > 1 && (
                            <button onClick={() => removeRegion(t.id, r.id)} className="p-0.5 text-red-400"><X size={10} /></button>
                          )}
                        </span>
                      ))}
                      <button onClick={() => { setSelectionMode('taskRegion'); setRegionTarget(t.id); }}
                        className={`text-[11px] px-1.5 py-0.5 rounded border border-dashed ${darkMode ? 'border-gray-600 text-gray-400 hover:border-amber-500' : 'border-gray-400 text-gray-500 hover:border-amber-500'}`}>
                        + Ausschnitt
                      </button>
                      <span className={`text-[11px] ml-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>{t.maxPoints} BE</span>
                    </div>
                  </div>
                  <button onClick={() => setTasks(tasks.filter((_, j) => j !== i))} className="p-1 hover:bg-red-500/20 rounded text-red-400 flex-shrink-0"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
          
          <div className={`pt-4 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex justify-between items-center mb-3">
              <span className="font-medium">Namensfeld (optional)</span>
              <button onClick={() => { setSelectionMode('nameField'); setCurrentPage(1); }} disabled={selectionMode}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${selectionMode === 'nameField' ? 'bg-sky-600 text-white' : darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-300 text-gray-700'} disabled:opacity-50`}>
                <Plus size={14} className="inline mr-1" />Feld
              </button>
            </div>
            {selectionMode === 'nameField' && <div className={`p-3 mb-3 rounded-lg text-sm ${darkMode ? 'bg-sky-900/30 border border-sky-700 text-sky-400' : 'bg-sky-100 border border-sky-300 text-sky-700'}`}>Ziehen Sie ein Rechteck über den Bereich, in dem der Schülername steht.</div>}

            <div className={`p-3 rounded-lg border mb-2 ${nameField ? (darkMode ? 'border-sky-700 bg-sky-900/20' : 'border-sky-300 bg-sky-50') : (darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50')}`}>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${nameField ? 'bg-sky-500' : 'bg-gray-500'}`} />
                  <span className="text-sm">Namensbereich</span>
                </div>
                {nameField && <button onClick={() => setNameField(null)} className="text-red-400 hover:text-red-300"><X size={14} /></button>}
              </div>
              <p className={`mt-2 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                {nameField ? `✓ Vor der Korrektur wird ein kurzer Durchlauf zum Transkribieren der Namen geöffnet (Seite ${nameField.page || 1}).` : 'Optional: Danach werden zuerst nur die Namensfelder nacheinander angezeigt.'}
              </p>
            </div>
          </div>

          <div className={`pt-4 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex justify-between items-center mb-3">
              <span className="font-medium">Ergebnisfelder</span>
              <button onClick={() => { setSelectionMode('scoreField'); setCurrentPage(1); }} disabled={selectionMode}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${selectionMode === 'scoreField' ? 'bg-green-600 text-white' : darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-300 text-gray-700'} disabled:opacity-50`}>
                <Plus size={14} className="inline mr-1" />Feld
              </button>
            </div>
            {selectionMode === 'scoreField' && <div className={`p-3 mb-3 rounded-lg text-sm ${darkMode ? 'bg-green-900/30 border border-green-700 text-green-400' : 'bg-green-100 border border-green-300 text-green-700'}`}>Ziehen Sie ein Rechteck für Punkte/Note (auf Seite 1)</div>}
            
            <div className={`p-3 rounded-lg border mb-2 ${scoreFields.totalField ? (darkMode ? 'border-green-700 bg-green-900/20' : 'border-green-300 bg-green-50') : (darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50')}`}>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${scoreFields.totalField ? 'bg-green-500' : 'bg-gray-500'}`} />
                  <span className="text-sm">BE gesamt</span>
                </div>
                {scoreFields.totalField && <button onClick={() => setScoreFields(f => ({ ...f, totalField: null }))} className="text-red-400 hover:text-red-300"><X size={14} /></button>}
              </div>
            </div>
            
            <div className={`p-3 rounded-lg border mb-2 ${scoreFields.gradeField ? (darkMode ? 'border-green-700 bg-green-900/20' : 'border-green-300 bg-green-50') : (darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50')}`}>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${scoreFields.gradeField ? 'bg-green-500' : 'bg-gray-500'}`} />
                  <span className="text-sm">Note</span>
                </div>
                {scoreFields.gradeField && <button onClick={() => setScoreFields(f => ({ ...f, gradeField: null }))} className="text-red-400 hover:text-red-300"><X size={14} /></button>}
              </div>
            </div>
            
            <p className={`text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              {scoreFields.totalField || scoreFields.gradeField 
                ? '✓ Felder werden beim PDF-Export mit Werten gefüllt.' 
                : 'Optional: Ohne Felder werden Punkte/Note oben rechts eingefügt.'}
            </p>
          </div>
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className={`p-3 border-b flex justify-center items-center gap-4 ${darkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className={`p-2 rounded disabled:opacity-30 ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}><ChevronLeft size={20} /></button>
            <span className="font-medium">Seite {currentPage} von {pagesPerStudent}</span>
            <button onClick={() => setCurrentPage(Math.min(pagesPerStudent, currentPage + 1))} disabled={currentPage === pagesPerStudent} className={`p-2 rounded disabled:opacity-30 ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}><ChevronRight size={20} /></button>
            <div className="flex items-center gap-1 ml-4">
              <button onClick={() => setZoom(z => Math.max(0.5, z - 0.2))} className={`p-1 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}><ZoomOut size={18} /></button>
              <span className="w-12 text-center text-sm">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(2, z + 0.2))} className={`p-1 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}><ZoomIn size={18} /></button>
            </div>
            {selectionMode && <button onClick={() => setSelectionMode(null)} className={`px-3 py-1.5 rounded-lg text-sm ml-4 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-300 hover:bg-gray-400'}`}><X size={14} className="inline mr-1" />Abbrechen</button>}
          </div>
          <div className={`flex-1 overflow-auto p-6 ${darkMode ? 'bg-gray-950' : 'bg-gray-200'}`}>
            <div className="flex justify-center">
              {pdfDoc && (
                <PDFPageView pdfDoc={pdfDoc} pageNumber={currentPage} scale={zoom}
                  regions={[
                    ...tasks.flatMap(t => {
                      const all = taskRegionsOf(t);
                      return all.filter(r => r.page === currentPage)
                        .map(r => ({ ...r.rect, name: all.length > 1 ? `${t.name} (${all.indexOf(r) + 1})` : t.name, color: 'amber' }));
                    }),
                    ...(nameField && currentPage === (nameField.page || 1) ? [{ ...nameField, name: 'Name', color: 'blue' }] : []),
                    ...(scoreFields.totalField && currentPage === 1 ? [{ ...scoreFields.totalField, name: 'Punkte', color: 'green' }] : []),
                    ...(scoreFields.gradeField && currentPage === 1 ? [{ ...scoreFields.gradeField, name: 'Note', color: 'green' }] : [])
                  ]}
                  selectionMode={!!selectionMode}
                  onSelect={r => {
                    if (selectionMode === 'task') {
                      setPendingRegion({ ...r, page: currentPage, type: 'task' });
                    } else if (selectionMode === 'taskRegion' && regionTarget) {
                      setTasks(ts => ts.map(t => t.id === regionTarget
                        ? syncLegacyTaskFields({ ...t, regions: [...taskRegionsOf(t), { id: `r_${Date.now()}`, page: currentPage, rect: { x: r.x, y: r.y, width: r.width, height: r.height } }] })
                        : t));
                      setRegionTarget(null);
                    } else if (selectionMode === 'nameField') {
                      setNameField({ ...r, page: currentPage });
                    } else if (selectionMode === 'scoreField') {
                      const fieldType = !scoreFields.totalField ? 'totalField' : !scoreFields.gradeField ? 'gradeField' : null;
                      if (fieldType) setScoreFields(f => ({ ...f, [fieldType]: r }));
                    }
                    setSelectionMode(null);
                  }} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== Field Position Editor ====================
function FieldPositionEditor({ pdfDoc, pageNumber, tasks, scoreFields, taskPointPositions, onSaveScoreFields, onSaveTaskPointPositions, onClose, darkMode }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [fields, setFields] = useState({ ...scoreFields });
  const [taskPosMap, setTaskPosMap] = useState({ ...taskPointPositions });
  const [dragging, setDragging] = useState(null); // { key, offsetX, offsetY }
  const [selectionMode, setSelectionMode] = useState(null); // null | 'totalField' | 'gradeField'
  const [drawStart, setDrawStart] = useState(null);
  const [drawRect, setDrawRect] = useState(null);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    (async () => {
      const page = await pdfDoc.getPage(pageNumber);
      const vp = page.getViewport({ scale: 1.2 });
      canvasRef.current.width = vp.width;
      canvasRef.current.height = vp.height;
      const ctx = canvasRef.current.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, vp.width, vp.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    })();
  }, [pdfDoc, pageNumber]);

  const getCoords = (e) => {
    const r = containerRef.current?.getBoundingClientRect();
    if (!r) return null;
    const cx = e.touches?.[0]?.clientX ?? e.clientX;
    const cy = e.touches?.[0]?.clientY ?? e.clientY;
    return { x: ((cx - r.left) / r.width) * 100, y: ((cy - r.top) / r.height) * 100 };
  };

  const handleMouseDown = (e) => {
    const c = getCoords(e);
    if (!c) return;
    if (selectionMode) {
      e.preventDefault();
      setDrawStart(c);
      setDrawRect({ x: c.x, y: c.y, width: 0, height: 0 });
      return;
    }
  };

  const handleMouseMove = (e) => {
    const c = getCoords(e);
    if (!c) return;
    if (drawStart && selectionMode) {
      setDrawRect({ x: Math.min(drawStart.x, c.x), y: Math.min(drawStart.y, c.y), width: Math.abs(c.x - drawStart.x), height: Math.abs(c.y - drawStart.y) });
      return;
    }
    if (dragging) {
      e.preventDefault();
      if (dragging.key === 'totalField' || dragging.key === 'gradeField') {
        setFields(f => {
          const old = f[dragging.key];
          if (!old) return f;
          return { ...f, [dragging.key]: { ...old, x: c.x - dragging.offsetX, y: c.y - dragging.offsetY } };
        });
      } else {
        // Task point position
        setTaskPosMap(m => ({ ...m, [dragging.key]: { x: c.x - dragging.offsetX, y: c.y - dragging.offsetY } }));
      }
    }
  };

  const handleMouseUp = () => {
    if (drawStart && selectionMode && drawRect && drawRect.width > 1 && drawRect.height > 1) {
      setFields(f => ({ ...f, [selectionMode]: drawRect }));
      setSelectionMode(null);
    }
    setDrawStart(null);
    setDrawRect(null);
    setDragging(null);
  };

  const startDrag = (key, e, field) => {
    e.stopPropagation();
    const c = getCoords(e);
    if (!c) return;
    setDragging({ key, offsetX: c.x - field.x, offsetY: c.y - field.y });
  };

  // Align all task point positions to a vertical line
  const alignVertical = () => {
    const positions = Object.entries(taskPosMap);
    if (positions.length === 0) return;
    // Find the rightmost x position (or average) and align all to it
    const maxX = Math.max(...positions.map(([, p]) => p.x));
    const aligned = {};
    positions.forEach(([k, p]) => { aligned[k] = { ...p, x: maxX }; });
    setTaskPosMap(aligned);
  };

  const handleSave = () => {
    onSaveScoreFields(fields);
    onSaveTaskPointPositions(taskPosMap);
    onClose();
  };

  // Default task point positions: top-right of region
  const getTaskPos = (task) => {
    if (taskPosMap[task.id]) return taskPosMap[task.id];
    if (task.region) return { x: task.region.x + task.region.width - 2, y: task.region.y + 0.5 };
    return { x: 85, y: 5 };
  };

  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[900px] max-h-[90vh] flex flex-col ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className={`p-4 border-b flex justify-between items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div>
            <h2 className="font-semibold text-lg">Felder positionieren</h2>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Ziehen Sie die Felder an die gewünschte Position auf Seite 1</p>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
        </div>
        
        <div className={`p-3 border-b flex gap-2 flex-wrap items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Ergebnisfelder:</span>
          <button onClick={() => setSelectionMode('totalField')} className={`px-3 py-1.5 rounded-lg text-sm ${selectionMode === 'totalField' ? 'bg-blue-600 text-white' : fields.totalField ? 'bg-green-600/20 text-green-500 border border-green-600' : darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
            {fields.totalField ? '✓ ' : ''}BE gesamt {selectionMode === 'totalField' ? '(ziehen...)' : ''}
          </button>
          <button onClick={() => setSelectionMode('gradeField')} className={`px-3 py-1.5 rounded-lg text-sm ${selectionMode === 'gradeField' ? 'bg-blue-600 text-white' : fields.gradeField ? 'bg-green-600/20 text-green-500 border border-green-600' : darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
            {fields.gradeField ? '✓ ' : ''}Note {selectionMode === 'gradeField' ? '(ziehen...)' : ''}
          </button>
          {fields.totalField && <button onClick={() => setFields(f => ({ ...f, totalField: null }))} className="text-red-400 text-sm hover:text-red-300">BE entfernen</button>}
          {fields.gradeField && <button onClick={() => setFields(f => ({ ...f, gradeField: null }))} className="text-red-400 text-sm hover:text-red-300">Note entfernen</button>}
          <div className={`ml-auto flex gap-2 border-l pl-3 ${darkMode ? 'border-gray-600' : 'border-gray-300'}`}>
            <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Aufgaben-BE:</span>
            <button onClick={alignVertical} title="Vertikal ausrichten" className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>
              <AlignCenterVertical size={14} /> Ausrichten
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-auto p-4" style={{ background: darkMode ? '#111' : '#ddd' }}>
          <div className="flex justify-center">
            <div ref={containerRef} className="relative inline-block select-none"
              onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
              <canvas ref={canvasRef} className="shadow-xl rounded-lg block" />
              
              {/* Score fields */}
              {fields.totalField && (
                <div className="absolute cursor-move border-2 border-green-500 bg-green-500/15 flex items-center justify-center"
                  style={{ left: `${fields.totalField.x}%`, top: `${fields.totalField.y}%`, width: `${fields.totalField.width}%`, height: `${fields.totalField.height}%` }}
                  onMouseDown={e => startDrag('totalField', e, fields.totalField)}>
                  <span className="text-green-600 font-bold text-xs pointer-events-none">BE</span>
                  <span className="absolute -top-5 left-0 bg-green-500 text-white text-xs px-1.5 rounded pointer-events-none">BE gesamt</span>
                </div>
              )}
              {fields.gradeField && (
                <div className="absolute cursor-move border-2 border-blue-500 bg-blue-500/15 flex items-center justify-center"
                  style={{ left: `${fields.gradeField.x}%`, top: `${fields.gradeField.y}%`, width: `${fields.gradeField.width}%`, height: `${fields.gradeField.height}%` }}
                  onMouseDown={e => startDrag('gradeField', e, fields.gradeField)}>
                  <span className="text-blue-600 font-bold text-xs pointer-events-none">Note</span>
                  <span className="absolute -top-5 left-0 bg-blue-500 text-white text-xs px-1.5 rounded pointer-events-none">Note</span>
                </div>
              )}
              
              {/* Task point labels */}
              {tasks.filter(t => t.page === 1).map(t => {
                const pos = getTaskPos(t);
                return (
                  <div key={t.id} className="absolute cursor-move" style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-100%, 0)' }}
                    onMouseDown={e => { e.stopPropagation(); const c = getCoords(e); if (c) setDragging({ key: t.id, offsetX: c.x - pos.x, offsetY: c.y - pos.y }); }}>
                    <div className="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded shadow whitespace-nowrap pointer-events-none">
                      —/{t.maxPoints} BE
                    </div>
                  </div>
                );
              })}
              
              {/* Task regions preview */}
              {tasks.filter(t => t.page === 1).map(t => (
                <div key={`r_${t.id}`} className="absolute border border-amber-500/40 bg-amber-500/5 pointer-events-none"
                  style={{ left: `${t.region.x}%`, top: `${t.region.y}%`, width: `${t.region.width}%`, height: `${t.region.height}%` }}>
                  <span className="absolute -top-4 left-0.5 text-amber-500/60 text-xs">{t.name}</span>
                </div>
              ))}
              
              {/* Drawing rect for new field */}
              {drawRect && drawRect.width > 0 && (
                <div className="absolute border-2 border-blue-500 bg-blue-500/20 pointer-events-none"
                  style={{ left: `${drawRect.x}%`, top: `${drawRect.y}%`, width: `${drawRect.width}%`, height: `${drawRect.height}%` }} />
              )}
            </div>
          </div>
        </div>
        
        <div className={`p-4 border-t flex gap-3 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <button onClick={onClose} className={`flex-1 py-2.5 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Abbrechen</button>
          <button onClick={handleSave} className="flex-1 py-2.5 bg-amber-600 text-white rounded-xl font-medium">Positionen speichern</button>
        </div>
      </div>
    </Modal>
  );
}

// ==================== Seiten-Thumbnail (Segmentierung) ====================
const segThumbCache = new Map(); // `${pdfPage}@${rotation}` -> dataURL

function SegPageThumb({ pdfDoc, pdfPage, rotation = 0, width = 100, darkMode }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (pdfPage == null || !pdfDoc) { setSrc(null); return; }
    const key = `${pdfPage}@${rotation}`;
    if (segThumbCache.has(key)) { setSrc(segThumbCache.get(key)); return; }
    (async () => {
      try {
        const page = await pdfDoc.getPage(pdfPage);
        const rot = ((page.rotate || 0) + rotation) % 360;
        const base = page.getViewport({ scale: 1, rotation: rot });
        const vp = page.getViewport({ scale: (width * 2) / base.width, rotation: rot });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const url = canvas.toDataURL('image/jpeg', 0.6);
        segThumbCache.set(key, url);
        if (!cancelled) setSrc(url);
      } catch { if (!cancelled) setSrc(null); }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, pdfPage, rotation, width]);

  if (pdfPage == null) return (
    <div className={`flex items-center justify-center text-center text-xs border-2 border-dashed rounded ${darkMode ? 'border-gray-700 text-gray-500' : 'border-gray-300 text-gray-500'}`}
      style={{ width, height: Math.round(width * 1.41) }}>
      fehlende<br />Seite
    </div>
  );
  return src
    ? <img src={src} alt={`Seite ${pdfPage}`} style={{ width }} className="block rounded shadow" draggable={false} />
    : <div className={`rounded animate-pulse ${darkMode ? 'bg-gray-800' : 'bg-gray-300'}`} style={{ width, height: Math.round(width * 1.41) }} />;
}

// ==================== Segmentierungs-Editor ====================
function SegmentationEditor({ pdfDoc, pageCount, students, onApply, onClose, darkMode }) {
  // Arbeitskopie – Änderungen werden erst bei „Übernehmen" zurückgegeben
  const [blocks, setBlocks] = useState(() =>
    students.map(s => ({ ...s, pages: (s.pages || []).map(p => ({ ...p })) }))
  );
  const [confirmAction, setConfirmAction] = useState(null); // { text, onYes }

  useEffect(() => { segThumbCache.clear(); }, []);

  const update = (fn) => setBlocks(prevBlocks => {
    const copy = prevBlocks.map(b => ({ ...b, pages: b.pages.map(p => ({ ...p })) }));
    fn(copy);
    return copy;
  });

  const hasContent = (b) =>
    Object.keys(b.grades || {}).length > 0 ||
    Object.values(b.annotations || {}).some(arr => (arr || []).length > 0);

  const newBlock = (pages = []) => ({
    id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: '', pages, grades: {}, annotations: {}, pending: [],
  });

  // --- Seitenaktionen ---
  const rotatePage = (bi, pi) => {
    const doIt = () => update(bs => { bs[bi].pages[pi].rotation = ((bs[bi].pages[pi].rotation || 0) + 90) % 360; });
    if (hasContent(blocks[bi])) setConfirmAction({
      text: 'Dieser Schüler hat bereits Bewertungen oder Annotationen. Vorhandene Markierungen drehen sich nicht mit – bitte nach dem Drehen kontrollieren. Fortfahren?',
      onYes: doIt,
    });
    else doIt();
  };
  const movePageWithin = (bi, pi, dir) => update(bs => {
    const ni = pi + dir;
    if (ni < 0 || ni >= bs[bi].pages.length) return;
    const p = bs[bi].pages;
    [p[pi], p[ni]] = [p[ni], p[pi]];
  });
  const movePageToBlock = (bi, pi, dir) => update(bs => {
    const ti = bi + dir;
    if (ti < 0 || ti >= bs.length) return;
    const [pg] = bs[bi].pages.splice(pi, 1);
    if (dir < 0) bs[ti].pages.push(pg); else bs[ti].pages.unshift(pg);
  });
  const unassignPage = (bi, pi) => update(bs => { bs[bi].pages.splice(pi, 1); });
  const addPlaceholder = (bi) => update(bs => { bs[bi].pages.push({ pdfPage: null, rotation: 0 }); });

  // --- Blockaktionen ---
  const splitBlock = (bi, pi) => update(bs => {
    if (pi === 0) return;
    const moved = bs[bi].pages.splice(pi);
    bs.splice(bi + 1, 0, newBlock(moved));
  });
  const mergeWithPrev = (bi) => {
    if (bi === 0) return;
    const doIt = () => update(bs => {
      bs[bi - 1].pages = [...bs[bi - 1].pages, ...bs[bi].pages];
      bs.splice(bi, 1);
    });
    if (hasContent(blocks[bi])) setConfirmAction({
      text: `„${blocks[bi].name || `Schüler ${bi + 1}`}" hat bereits Bewertungen oder Annotationen, die beim Zusammenführen verloren gehen. Fortfahren?`,
      onYes: doIt,
    });
    else doIt();
  };
  const addEmptyBlock = () => update(bs => { bs.push(newBlock()); });
  const removeEmptyBlock = (bi) => update(bs => { if (!bs[bi].pages.length && !hasContent(bs[bi])) bs.splice(bi, 1); });

  // --- Pool & Soft-Warnungen ---
  const assignedPages = new Set(blocks.flatMap(b => b.pages.map(p => p.pdfPage).filter(n => n != null)));
  const unassigned = Array.from({ length: pageCount || 0 }, (_, i) => i + 1).filter(n => !assignedPages.has(n));
  const assignTo = (pdfPage, bi) => update(bs => { bs[bi].pages.push({ pdfPage, rotation: 0 }); });

  const lengths = blocks.map(b => b.pages.length).filter(n => n > 0).sort((a, b) => a - b);
  const typicalLen = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0;
  const oddBlocks = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.pages.length !== typicalLen);

  const btnCls = `p-1 rounded disabled:opacity-20 ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-300 text-gray-600'}`;

  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[900px] max-h-[85vh] flex flex-col ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className={`p-4 border-b flex justify-between items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div>
            <h2 className="font-semibold text-lg">Segmentierung bearbeiten</h2>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Seiten drehen, verschieben, Schüler trennen oder zusammenführen
            </p>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
        </div>

        {(unassigned.length > 0 || (oddBlocks.length > 0 && typicalLen > 0)) && (
          <div className={`px-4 py-2 border-b text-sm flex flex-col gap-1 ${darkMode ? 'border-gray-700 bg-amber-900/20 text-amber-400' : 'border-gray-200 bg-amber-50 text-amber-700'}`}>
            {unassigned.length > 0 && (
              <span><AlertTriangle size={14} className="inline mr-1" />{unassigned.length} Seite(n) keinem Schüler zugeordnet (siehe unten)</span>
            )}
            {oddBlocks.length > 0 && typicalLen > 0 && (
              <span><AlertTriangle size={14} className="inline mr-1" />
                Abweichende Seitenzahl (üblich: {typicalLen}): {oddBlocks.map(({ b, i }) => `${b.name || `Schüler ${i + 1}`} (${b.pages.length})`).join(', ')}
              </span>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {blocks.map((b, bi) => (
            <div key={b.id} className={`mb-3 p-3 rounded-xl border ${darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{b.name || `Schüler ${bi + 1}`}</span>
                  <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>{b.pages.length} Seiten</span>
                  {hasContent(b) && <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-500">bewertet</span>}
                </div>
                <div className="flex gap-1 items-center">
                  {bi > 0 && (
                    <button onClick={() => mergeWithPrev(bi)} title="Seiten an den vorherigen Schüler anhängen, diesen Schüler entfernen"
                      className={`px-2 py-1 rounded text-xs ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}>
                      mit vorherigem zusammenführen
                    </button>
                  )}
                  {b.pages.length === 0 && !hasContent(b) && (
                    <button onClick={() => removeEmptyBlock(bi)} title="Leeren Schüler entfernen" className="p-1 rounded text-red-400 hover:bg-red-500/20"><Trash2 size={14} /></button>
                  )}
                </div>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {b.pages.map((pg, pi) => (
                  <div key={pi} className="flex-shrink-0">
                    <div className="relative">
                      <SegPageThumb pdfDoc={pdfDoc} pdfPage={pg.pdfPage} rotation={pg.rotation} width={100} darkMode={darkMode} />
                      {pg.pdfPage != null && (
                        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]">S. {pg.pdfPage}</span>
                      )}
                      {(pg.rotation || 0) !== 0 && (
                        <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-amber-500 text-white text-[10px]">{pg.rotation}°</span>
                      )}
                    </div>
                    <div className="flex justify-center gap-0.5 mt-1">
                      <button onClick={() => movePageToBlock(bi, pi, -1)} disabled={bi === 0} title="Zum vorherigen Schüler verschieben" className={btnCls}><ArrowLeft size={12} /></button>
                      <button onClick={() => movePageWithin(bi, pi, -1)} disabled={pi === 0} title="Nach vorne" className={btnCls}><ChevronLeft size={12} /></button>
                      <button onClick={() => rotatePage(bi, pi)} title="90° im Uhrzeigersinn drehen" className={btnCls}><RotateCw size={12} /></button>
                      <button onClick={() => movePageWithin(bi, pi, 1)} disabled={pi === b.pages.length - 1} title="Nach hinten" className={btnCls}><ChevronRight size={12} /></button>
                      <button onClick={() => movePageToBlock(bi, pi, 1)} disabled={bi === blocks.length - 1} title="Zum nächsten Schüler verschieben" className={btnCls}><ArrowRight size={12} /></button>
                    </div>
                    <div className="flex justify-center gap-0.5 mt-0.5">
                      {pi > 0 && (
                        <button onClick={() => splitBlock(bi, pi)} title="Ab dieser Seite neuer Schüler" className={btnCls}><Scissors size={12} /></button>
                      )}
                      <button onClick={() => unassignPage(bi, pi)} title="Seite aus diesem Schüler entfernen (landet im Pool unten)" className={`${btnCls} text-red-400`}><X size={12} /></button>
                    </div>
                  </div>
                ))}
                <button onClick={() => addPlaceholder(bi)} title="Platzhalter für eine fehlende Seite anhängen"
                  className={`flex-shrink-0 w-[100px] rounded border-2 border-dashed text-xs ${darkMode ? 'border-gray-700 text-gray-500 hover:border-amber-500' : 'border-gray-300 text-gray-500 hover:border-amber-500'}`}
                  style={{ height: 141 }}>
                  + Platzhalter
                </button>
              </div>
            </div>
          ))}

          {unassigned.length > 0 && (
            <div className={`p-3 rounded-xl border-2 border-dashed ${darkMode ? 'border-amber-700/50' : 'border-amber-300'}`}>
              <p className="text-sm font-medium mb-2">Nicht zugeordnete Seiten</p>
              <div className="flex gap-3 overflow-x-auto">
                {unassigned.map(n => (
                  <div key={n} className="flex-shrink-0">
                    <div className="relative">
                      <SegPageThumb pdfDoc={pdfDoc} pdfPage={n} width={100} darkMode={darkMode} />
                      <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]">S. {n}</span>
                    </div>
                    <select value="" onChange={e => assignTo(n, parseInt(e.target.value, 10))}
                      className={`mt-1 w-[100px] text-xs px-1 py-1 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}>
                      <option value="" disabled>zuordnen zu…</option>
                      {blocks.map((blk, i) => <option key={blk.id} value={i}>{blk.name || `Schüler ${i + 1}`}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <p className={`text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                Doppelt gescannte Seiten können einfach hier liegen bleiben – sie erscheinen dann in keinem Export.
              </p>
            </div>
          )}
        </div>

        <div className={`p-4 border-t flex justify-between items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <button onClick={addEmptyBlock} className={`px-3 py-2 rounded-lg text-sm ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>
            <Plus size={14} className="inline mr-1" />Leeren Schüler anlegen
          </button>
          <div className="flex gap-3">
            <button onClick={onClose} className={`px-5 py-2 rounded-xl ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>Abbrechen</button>
            <button onClick={() => onApply(blocks)} className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-medium">Übernehmen</button>
          </div>
        </div>
      </div>

      {confirmAction && (
        <Modal onClose={() => setConfirmAction(null)}>
          <div className={`rounded-2xl w-[420px] p-6 ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
            <div className="flex items-center gap-3 mb-3"><AlertTriangle className="text-amber-500" size={22} /><h3 className="font-semibold">Achtung</h3></div>
            <p className={`text-sm mb-5 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{confirmAction.text}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmAction(null)} className={`flex-1 py-2 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Abbrechen</button>
              <button onClick={() => { confirmAction.onYes(); setConfirmAction(null); }} className="flex-1 py-2 bg-amber-600 text-white rounded-xl font-medium">Fortfahren</button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

// ==================== Grading ====================
function GradingView({ darkMode, setDarkMode, project, onSave, onBack, vaultPassword }) {
  const role = project.correctionRole || 'first';
  const pointsKey = role === 'second' ? 'secondPoints' : 'points';
  const otherRole = role === 'second' ? 'first' : 'second';

  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfError, setPdfError] = useState(null);
  const [showSegEditor, setShowSegEditor] = useState(false);
  const [students, setStudents] = useState(project.students || []);
  const [tasks, setTasks] = useState(migrateTaskRegions(project.tasks || []));
  const [taskIdx, setTaskIdx] = useState(project.resumeTask || 0);
  const [studentIdx, setStudentIdx] = useState(project.resumeStudent || 0);
  const [zoom, setZoom] = useState(1);
  const [showFull, setShowFull] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTool, setActiveTool] = useState(null);
  const [penColor, setPenColor] = useState(role === 'second' ? '#22c55e' : '#ef4444');
  const [textColor, setTextColor] = useState(role === 'second' ? '#22c55e' : '#ef4444');
  // Default text size tuned for typical correction annotations (can be adjusted in the toolbar).
  const [textSize, setTextSize] = useState(18);
  const [textOpacity, setTextOpacity] = useState(1);
  const [markSize, setMarkSize] = useState(30);
  const lastPenColorRef = useRef(role === 'second' ? '#22c55e' : '#ef4444');
  const [lineWidth, setLineWidth] = useState(3);
  const [underlineStyle, setUnderlineStyle] = useState('solid');
  const [underlineDouble, setUnderlineDouble] = useState(false);
  const [underlineHook, setUnderlineHook] = useState(false);

  // If the user hasn't chosen a dedicated text color, keep it in sync with the pen color
  useEffect(() => {
    if (textColor === lastPenColorRef.current) setTextColor(penColor);
    lastPenColorRef.current = penColor;
  }, [penColor]);
  const [selectedMark, setSelectedMark] = useState(null);
  const [correctionMarks, setCorrectionMarks] = useState(ensureRequiredCorrectionMarks(project.correctionMarks || defaultCorrectionMarks));
  const [showMarksEditor, setShowMarksEditor] = useState(false);
  const [showUnderlineEditor, setShowUnderlineEditor] = useState(false);
  const [showOtherLayer, setShowOtherLayer] = useState(false);
  const nameField = project.nameField || null;
  const [gradeTable, setGradeTable] = useState(normalizeGradeTable(project.gradeTable || defaultGradeTableSekI));
  const [showGradeEditor, setShowGradeEditor] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [showReview, setShowReview] = useState(false);
  const [reviewMode, setReviewMode] = useState('task'); // 'task' (Vergleich) | 'student' (ganze Arbeit)
  const [showConflicts, setShowConflicts] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [regionIdx, setRegionIdx] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const [showFieldEditor, setShowFieldEditor] = useState(false);
  const [scoreFields, setScoreFields] = useState(project.scoreFields || { totalField: null, gradeField: null });
  const [taskPointPositions, setTaskPointPositions] = useState(project.taskPointPositions || {});
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  // Musterlösung
  const [modelSolutions, setModelSolutions] = useState(project.modelSolutions || {});
  const [showModelSolution, setShowModelSolution] = useState(false);
  const [modelOpacity, setModelOpacity] = useState(project.modelSolutionOpacity ?? defaultModelOpacity);
  const [editingModel, setEditingModel] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  // Diagnose: Fehlerarten-Katalog (pro Klassenarbeit) + Auswahl pro Schüler/Aufgabe
  const [diagnosticCatalog, setDiagnosticCatalog] = useState(project.diagnosticCatalog || []);
  const [showDiagnostics, setShowDiagnostics] = useState(true);
  const [diagnosticsCollapsed, setDiagnosticsCollapsed] = useState(true);
  const [newErrorLabel, setNewErrorLabel] = useState('');
  const [newErrorCompetence, setNewErrorCompetence] = useState('');
  const [showDiagCatalogEditor, setShowDiagCatalogEditor] = useState(false);
  const firstUnnamedIndex = useMemo(() => students.findIndex(s => !(s.name || '').trim()), [students]);
  const [showNameCapture, setShowNameCapture] = useState(!!project.nameField && (project.students || []).some(s => !(s.name || '').trim()));

  const task = tasks[taskIdx];
  const student = students[studentIdx];

  // ==================== Multi-Ausschnitte (Schritt 9) ====================
  const regions = task ? taskRegionsOf(task) : [];
  const region = regions[Math.min(regionIdx, Math.max(regions.length - 1, 0))];
  const ovKey = task && region ? overrideKeyFor(task, region) : null;
  const effectiveRect = (ovKey && student?.regionOverrides?.[ovKey]) || region?.rect;
  const annKey = task && region ? annKeyFor(task, region, Math.min(regionIdx, regions.length - 1)) : null;
  const partsKey = pointsKey === 'points' ? 'parts' : 'secondParts';
  const currentPart = student?.grades?.[task?.id]?.[partsKey]?.[region?.id];

  const modelAnnsRaw = (modelSolutions?.[annKey] || []).map(a => ({ ...a, role: MODEL_ROLE }));
  const modelExists = modelAnnsRaw.length > 0;

  const allAnnotations = student?.annotations?.[annKey] || [];
  // keep current correction roles
  const annotations = allAnnotations.filter(a => {
    const r = a?.role || 'first';
    return r === role || (showOtherLayer && r === otherRole);
  });
  const myAnnotations = allAnnotations.filter(a => (a?.role || 'first') === role);

  const modelOverlay = (showModelSolution && modelExists && !editingModel)
    ? modelAnnsRaw.map(a => toModelOverlayAnnotation(a, modelOpacity))
    : [];

  const displayAnnotations = editingModel ? modelAnnsRaw : [...modelOverlay, ...annotations];
  const underlineEntries = (editingModel ? (modelAnnsRaw || []) : (student?.annotations?.[task?.id] || []))
    .map((annotation, index) => ({ annotation, index }))
    .filter(({ annotation }) => annotation?.type === 'underline' && (editingModel ? true : ((annotation?.role || 'first') === role)));
  const activeCanvasRole = editingModel ? MODEL_ROLE : role;

  useEffect(() => {
    if (nameField && firstUnnamedIndex >= 0) return;
    if (firstUnnamedIndex < 0 && showNameCapture) setShowNameCapture(false);
  }, [nameField, firstUnnamedIndex, showNameCapture]);

  // Backport older projects: ensure every annotation has a role
  useEffect(() => {
    setStudents(s => s.map(st => {
      const anns = st.annotations || {};
      const fixed = {};
      Object.keys(anns).forEach(k => {
        fixed[k] = (anns[k] || []).map(normalizeAnnotationRole);
      });
      return { ...st, annotations: fixed };
    }));
  }, [project.id]);

  // Backport: ensure diagnostics structure exists (per task: { first: [], second: [] })
  useEffect(() => {
    setStudents(s => s.map(st => {
      const d = st.diagnostics || {};
      const fixed = {};
      Object.keys(d).forEach(tid => {
        const val = d[tid];
        if (Array.isArray(val)) {
          fixed[tid] = { first: val, second: [] };
        } else if (val && typeof val === 'object') {
          fixed[tid] = {
            first: Array.isArray(val.first) ? val.first : [],
            second: Array.isArray(val.second) ? val.second : []
          };
        }
      });
      return { ...st, diagnostics: fixed };
    }));
    setDiagnosticCatalog(project.diagnosticCatalog || []);
  }, [project.id]);

  // Backport: normalize Musterlösung-Anmerkungen + Default-Sichtbarkeit
  useEffect(() => {
    setModelSolutions(ms => {
      const fixed = {};
      Object.keys(ms || {}).forEach(tid => {
        fixed[tid] = (ms[tid] || []).map(a => ({ ...a, role: MODEL_ROLE }));
      });
      return fixed;
    });
    const hasAny = Object.values(project.modelSolutions || {}).some(arr => (arr || []).length > 0);
    if (hasAny) setShowModelSolution(true);
  }, [project.id]);

  // Safety: Musterlösungs-Modus nur in Erstkorrektur bei Schüler 1
  useEffect(() => {
    if (editingModel && (role !== 'first' || studentIdx !== 0)) setEditingModel(false);
  }, [editingModel, role, studentIdx]);


  useEffect(() => {
    setCorrectionMarks(ensureRequiredCorrectionMarks(project.correctionMarks || defaultCorrectionMarks));
  }, [project.id]);

  useEffect(() => {
    if (!selectedMark) return;
    const updated = (correctionMarks || []).find(m => m.id === selectedMark.id);
    if (!updated) {
      setSelectedMark(null);
      if (activeTool === 'mark') setActiveTool(null);
      return;
    }
    if (updated !== selectedMark) setSelectedMark(updated);
  }, [correctionMarks, selectedMark, activeTool]);

  useEffect(() => {
    (async () => {
      try {
        if (project.pdfArrayBuffer) {
          const lib = await loadPdfJs();
          setPdfDoc(await lib.getDocument({ data: project.pdfArrayBuffer.slice(0) }).promise);
        } else if (project.pdfData?.arrayBuffer) {
          const lib = await loadPdfJs();
          setPdfDoc(await lib.getDocument({ data: await project.pdfData.arrayBuffer() }).promise);
        } else if (project.isDemo) {
          setPdfDoc(createDemoPdf(project.pageCount || 8));
        } else {
          setPdfError('Das Quell-PDF dieses Projekts wurde nicht gefunden.');
        }
      } catch (e) {
        if (project.isDemo) setPdfDoc(createDemoPdf(project.pageCount || 8));
        else setPdfError('Das Quell-PDF konnte nicht geladen werden: ' + (e?.message || e));
      }
      finally { setLoading(false); }
    })();
  }, [project]);

  // PDF neu verknüpfen (z. B. nach Datenverlust im Browser-Speicher)
  const relinkPdf = async (file) => {
    try {
      const buf = await file.arrayBuffer();
      const lib = await loadPdfJs();
      const doc = await lib.getDocument({ data: buf.slice(0) }).promise;
      if (project.pageCount && doc.numPages !== project.pageCount) {
        setToast({ message: `Seitenzahl passt nicht: PDF hat ${doc.numPages}, Projekt erwartet ${project.pageCount}.`, type: 'error' });
        return;
      }
      if (project.sourcePdfSha256 && (await sha256Hex(buf)) !== project.sourcePdfSha256) {
        setToast({ message: 'Das ist nicht das ursprüngliche Klassen-PDF (Prüfsumme weicht ab).', type: 'error' });
        return;
      }
      setPdfDoc(doc);
      setPdfError(null);
      onSave?.({ ...project, pdfArrayBuffer: buf });
      setToast({ message: 'PDF erfolgreich neu verknüpft.', type: 'success' });
    } catch (e) {
      setToast({ message: 'Datei konnte nicht gelesen werden: ' + (e?.message || e), type: 'error' });
    }
  };

  // Workflow-Hinweis: Segmentierung vor Korrekturbeginn prüfen
  // (Rotationen/Verschiebungen sollten vor den ersten Annotationen erledigt sein)
  useEffect(() => {
    const hasAnyGrade = (project.students || []).some(s => Object.keys(s.grades || {}).length > 0 || Object.values(s.annotations || {}).some(arr => (arr || []).length > 0));
    if (!project.isDemo && !hasAnyGrade && role === 'first') {
      setToast({ message: 'Tipp: Prüfen Sie zuerst die Seitenzuordnung über das Scheren-Symbol (Segmentierung).', type: 'success' });
    }
  }, [project.id]);

  // Auto-save every 2 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      save(true);
    }, 120000);
    return () => clearInterval(interval);
  }, [students, tasks, gradeTable, correctionMarks, taskIdx, studentIdx]);

  const pageRef = () => student?.pages?.[((region?.page) || 1) - 1]
    ?? (student?.pageStart ? { pdfPage: student.pageStart + ((region?.page) || 1) - 1, rotation: 0 } : null);
  const pageNum = () => pageRef()?.pdfPage ?? null;
  const pageRotation = () => pageRef()?.rotation || 0;
  const points = student?.grades?.[task?.id]?.[pointsKey];
  const otherPointsKey = role === 'second' ? 'points' : 'secondPoints';
  const hasOtherLayerHere = !!student?.grades?.[task?.id]?.[otherPointsKey] || allAnnotations.some(a => (a?.role || 'first') === otherRole);
  const canViewOtherLayer = role === 'first' ? true : !!project.allowSecondViewFirst;
  const canToggleOtherLayer = canViewOtherLayer && hasOtherLayerHere;
  const isOverlayOpen = showReview || showResults || showCompletion || showGradeEditor || showFieldEditor || !!editingTask || showSegEditor || showConflicts || showOverride;

  // --- Diagnose helpers (Fehlerarten) ---
  const selectedDiagnostics = (student && task) ? (student.diagnostics?.[task.id]?.[role] || []) : [];
  const catalog = diagnosticCatalog || [];

  const checkStampPoints = useMemo(() => {
    const relevant = (myAnnotations || []).filter(a => a?.type === 'mark' && (a?.style || 'badge') === 'stamp');
    let full = 0;
    let half = 0;
    relevant.forEach(a => {
      const variant = getStampVariant(a);
      if (variant === 'check') full += 1;
      else if (variant === 'check_crossed') half += 1;
    });
    const suggested = full + half * 0.5;
    return { full, half, suggested, hasAny: (full + half) > 0 };
  }, [myAnnotations, task?.maxPoints]);

  const setDiagnosticSelection = (errorId, mode = 'toggle') => {
    if (!student || !task || editingModel) return;
    setStudents(prev => {
      const u = [...prev];
      const st = { ...u[studentIdx] };
      const d = { ...(st.diagnostics || {}) };
      const perTask = d[task.id] ? { ...d[task.id] } : { first: [], second: [] };
      const arr = Array.isArray(perTask[role]) ? [...perTask[role]] : [];
      const has = arr.includes(errorId);

      let next = arr;
      if (mode === 'toggle') {
        next = has ? arr.filter(x => x !== errorId) : [...arr, errorId];
      } else if (mode === 'add') {
        next = has ? arr : [...arr, errorId];
      } else if (mode === 'remove') {
        next = has ? arr.filter(x => x !== errorId) : arr;
      }

      perTask[role] = next;
      d[task.id] = perTask;
      st.diagnostics = d;
      u[studentIdx] = st;
      return u;
    });
  };

  const toggleDiagnostic = (errorId) => setDiagnosticSelection(errorId, 'toggle');

  const addDiagnosticType = (label, competence = '') => {
    const raw = (label || '').trim();
    const comp = (competence || '').trim();
    if (!raw || !student || !task || editingModel) return;

    const existing = (catalog || []).find(e => (e.label || '').trim().toLowerCase() === raw.toLowerCase());
    const id = existing?.id || `e_${Date.now()}`;

    if (!existing) {
      setDiagnosticCatalog(prev => ([...(prev || []), { id, label: raw, competence: comp || '' }]));
    } else if (comp && !existing.competence) {
      // allow adding a competence later by re-adding the same label with a competence
      setDiagnosticCatalog(prev => (prev || []).map(e => e.id === id ? { ...e, competence: comp } : e));
    }

    // ensure it is selected for current student/task
    setDiagnosticSelection(id, 'add');
    setNewErrorLabel('');
    setNewErrorCompetence('');
  };

  const updateDiagnosticType = (id, patch) => {
    if (!id) return;
    setDiagnosticCatalog(prev => (prev || []).map(e => e.id === id ? { ...e, ...patch } : e));
  };

  const deleteDiagnosticType = (id) => {
    if (!id) return;
    const entry = (catalog || []).find(e => e.id === id);
    const label = entry?.label || 'diese Fehlerart';
    const ok = window.confirm(`Fehlerart "${label}" wirklich löschen?\n\nSie wird auch aus allen bisherigen Markierungen dieser Klassenarbeit entfernt.`);
    if (!ok) return;

    setDiagnosticCatalog(prev => (prev || []).filter(e => e.id !== id));
    setStudents(prev => prev.map(st => {
      const d = st.diagnostics || {};
      const next = {};
      Object.keys(d).forEach(tid => {
        const per = d[tid] || { first: [], second: [] };
        next[tid] = {
          ...per,
          first: (per.first || []).filter(x => x !== id),
          second: (per.second || []).filter(x => x !== id)
        };
      });
      return { ...st, diagnostics: next };
    }));
    showToast(`Fehlerart „${label}“ gelöscht.`, 'success');
  };

useEffect(() => {
    if (!canViewOtherLayer) setShowOtherLayer(false);
  }, [canViewOtherLayer]);

  const setPoints = (p) => setStudents(s => {
    const u = [...s];
    if (!u[studentIdx].grades) u[studentIdx].grades = {};
    const prev = { ...(u[studentIdx].grades[task.id] || {}) };
    prev[pointsKey] = Math.max(0, Number(p) || 0);
    // Direkter Eingriff verwirft die Rasterauswahl dieser Rolle (kein Widerspruch zum Aggregat)
    if (task?.rubric) delete prev[role === 'second' ? 'secondRubric' : 'rubric'];
    u[studentIdx].grades[task.id] = prev;
    if (u[studentIdx].pending) u[studentIdx].pending = u[studentIdx].pending.filter(id => id !== task.id);
    return u;
  });

  // Punkte aus dem Review heraus ändern (beliebiger Schüler/Aufgabe)
  const reviewSetPoints = (idx, p, tId) => setStudents(s => {
    const u = [...s];
    if (!u[idx].grades) u[idx].grades = {};
    const prevGrades = { ...(u[idx].grades[tId] || {}) };
    prevGrades[pointsKey] = p;
    // Bei Multi-Ausschnitt-Aufgaben widersprächen sich Aggregat und Teil-BE -> Teile verwerfen
    const t = tasks.find(x => x.id === tId);
    if (t && taskRegionsOf(t).length > 1) delete prevGrades[pointsKey === 'points' ? 'parts' : 'secondParts'];
    if (t?.rubric) delete prevGrades[pointsKey === 'points' ? 'rubric' : 'secondRubric'];
    u[idx].grades[tId] = prevGrades;
    if (u[idx].pending) u[idx].pending = u[idx].pending.filter(id => id !== tId);
    return u;
  });

  // Final-BE einer Aufgabe setzen/aufheben (undefined = entfinalisieren)
  const setFinalPoints = (idx, tId, value) => setStudents(s => {
    const u = [...s];
    if (!u[idx].grades) u[idx].grades = {};
    const g = { ...(u[idx].grades[tId] || {}) };
    if (value === undefined) delete g.finalPoints; else g.finalPoints = value;
    u[idx].grades[tId] = g;
    return u;
  });

  // Final-Gesamtsumme überschreiben/aufheben
  const setFinalTotal = (idx, value) => setStudents(s => {
    const u = [...s];
    u[idx] = { ...u[idx] };
    if (value === undefined) delete u[idx].finalTotal; else u[idx].finalTotal = value;
    return u;
  });

  // Konflikte (rot ≠ grün) über alle Schüler/Aufgaben
  const conflictInfo = useMemo(() => {
    let total = 0, open = 0;
    students.forEach(st => tasks.forEach(t => {
      const g = st.grades?.[t.id];
      if (hasConflict(g)) { total++; if (g.finalPoints === undefined) open++; }
    }));
    return { total, open };
  }, [students, tasks]);

  // Teil-BE je Ausschnitt; Aufgaben-BE = gedeckelte Summe (Spec 3.2)
  const setPartPoints = (rId, p) => setStudents(s => {
    const u = [...s];
    if (!u[studentIdx].grades) u[studentIdx].grades = {};
    const g = { ...(u[studentIdx].grades[task.id] || {}) };
    const parts = { ...(g[partsKey] || {}) };
    parts[rId] = Math.max(0, Math.round(p * 2) / 2);
    g[partsKey] = parts;
    const sum = Object.values(parts).reduce((a, b) => a + (b || 0), 0);
    g[pointsKey] = Math.min(Math.round(sum * 2) / 2, task.maxPoints);
    u[studentIdx].grades[task.id] = g;
    if (u[studentIdx].pending) u[studentIdx].pending = u[studentIdx].pending.filter(id => id !== task.id);
    return u;
  });

  // Ausschnitt-Override pro Schüler setzen/aufheben
  const setRegionOverride = (rect) => setStudents(s => {
    const u = [...s];
    u[studentIdx] = { ...u[studentIdx] };
    const o = { ...(u[studentIdx].regionOverrides || {}) };
    if (rect) o[ovKey] = rect; else delete o[ovKey];
    u[studentIdx].regionOverrides = o;
    return u;
  });

  // ==================== Bewertungsraster (Schritt 11) ====================
  const rubricKey = role === 'second' ? 'secondRubric' : 'rubric';

  const setRubricLevel = (critId, pts) => {
    if (!task?.rubric) return;
    setStudents(prev => prev.map((s, i) => {
      if (i !== studentIdx) return s;
      const grades = { ...(s.grades || {}) };
      const g = { ...(grades[task.id] || {}) };
      const sel = { ...(g[rubricKey] || {}) };
      if (sel[critId] === pts) delete sel[critId];      // erneuter Klick = abwählen
      else sel[critId] = pts;
      if (Object.keys(sel).length === 0) {
        delete g[rubricKey];
        delete g[pointsKey];                            // Aufgabe wieder offen
      } else {
        g[rubricKey] = sel;
        const sum = Object.values(sel).reduce((a, b) => a + (b || 0), 0);
        g[pointsKey] = Math.min(sum, task.maxPoints);   // gedeckelte Summe = Aggregat
      }
      grades[task.id] = g;
      const pending = (s.pending || []).filter(id => id !== task.id);
      return { ...s, grades, pending };
    }));
  };

  // ==================== Punkte-Schnelleingabe (Tastatur, Schritt 2) ====================
  const [pointsBuffer, setPointsBuffer] = useState('');

  const commitBuffer = (buf) => {
    const v = parseFloat(buf.replace(',', '.'));
    if (isNaN(v)) return;
    if (regions.length > 1 && !task?.rubric) setPartPoints(region.id, v);
    else setPoints(Math.round(v * 2) / 2); // 0,5-Raster; bewusst KEINE Deckelung (Bonus möglich)
  };

  // Puffer leeren, sobald Schüler, Aufgabe oder Ausschnitt wechselt
  useEffect(() => { setPointsBuffer(''); }, [studentIdx, taskIdx, regionIdx]);
  // Beim Wechsel von Schüler/Aufgabe zum ersten Ausschnitt zurück
  useEffect(() => { setRegionIdx(0); }, [taskIdx, studentIdx]);

  const setStudentNameAtIndex = (idx, value) => setStudents(s => {
    const u = [...s];
    if (!u[idx]) return u;
    u[idx] = { ...u[idx], name: (value || '').trim() };
    return u;
  });

  const addAnn = (a) => setStudents(s => {
    const u = [...s];
    if (!u[studentIdx].annotations) u[studentIdx].annotations = {};
    if (!u[studentIdx].annotations[annKey]) u[studentIdx].annotations[annKey] = [];
    u[studentIdx].annotations[annKey] = [...u[studentIdx].annotations[annKey], { ...a, role }];
    return u;
  });
  const delAnn = (a) => setStudents(s => {
    const u = [...s];
    if (u[studentIdx].annotations?.[annKey]) u[studentIdx].annotations[annKey] = u[studentIdx].annotations[annKey].filter(x => x !== a);
    return u;
  });

  const updateAnnAtIndex = (annIndex, patch) => setStudents(s => {
    const u = [...s];
    const arr = u[studentIdx].annotations?.[annKey] || [];
    if (!arr[annIndex]) return u;
    u[studentIdx].annotations[annKey] = arr.map((ann, i) => i === annIndex ? { ...ann, ...patch } : ann);
    return u;
  });

  const delAnnAtIndex = (annIndex) => setStudents(s => {
    const u = [...s];
    const arr = u[studentIdx].annotations?.[annKey] || [];
    if (!arr[annIndex]) return u;
    u[studentIdx].annotations[annKey] = arr.filter((_, i) => i !== annIndex);
    return u;
  });
  const undoAnn = () => setStudents(s => {
    const u = [...s];
    const arr = u[studentIdx].annotations?.[annKey] || [];
    if (!arr.length) return u;
    // remove last annotation of current role
    let idx = -1;
    for (let i = arr.length - 1; i >= 0; i--) {
      if ((arr[i]?.role || 'first') === role) { idx = i; break; }
    }
    if (idx === -1) return u;
    u[studentIdx].annotations[annKey] = [...arr.slice(0, idx), ...arr.slice(idx + 1)];
    return u;
  });


  // Musterlösung-Annotationen
  const addModelAnn = (a) => setModelSolutions(ms => {
    const out = { ...(ms || {}) };
    const arr = out[annKey] ? [...out[annKey]] : [];
    out[annKey] = [...arr, { ...a, role: MODEL_ROLE }];
    return out;
  });

  const delModelAnn = (a) => setModelSolutions(ms => {
    const out = { ...(ms || {}) };
    out[annKey] = (out[annKey] || []).filter(x => x !== a);
    return out;
  });

  const updateModelAnnAtIndex = (annIndex, patch) => setModelSolutions(ms => {
    const out = { ...(ms || {}) };
    const arr = out[annKey] || [];
    if (!arr[annIndex]) return out;
    out[annKey] = arr.map((ann, i) => i === annIndex ? { ...ann, ...patch } : ann);
    return out;
  });

  const delModelAnnAtIndex = (annIndex) => setModelSolutions(ms => {
    const out = { ...(ms || {}) };
    const arr = out[annKey] || [];
    if (!arr[annIndex]) return out;
    out[annKey] = arr.filter((_, i) => i !== annIndex);
    return out;
  });

  const undoModelAnn = () => setModelSolutions(ms => {
    const out = { ...(ms || {}) };
    const arr = out[annKey] || [];
    if (!arr.length) return out;
    out[annKey] = arr.slice(0, -1);
    return out;
  });

  const isLastStudent = studentIdx >= students.length - 1;
  const isLastTask = taskIdx >= tasks.length - 1;

  const next = () => {
    if (!isLastStudent) {
      setStudentIdx(i => i + 1);
    } else if (!isLastTask) {
      setTaskIdx(i => i + 1);
      setStudentIdx(0);
    } else {
      // Last student of last task — show completion
      setShowCompletion(true);
    }
  };
  const prev = () => { if (studentIdx > 0) setStudentIdx(i => i - 1); };
  const skip = () => { setStudents(s => { const u = [...s]; if (!u[studentIdx].pending) u[studentIdx].pending = []; if (!u[studentIdx].pending.includes(task.id)) u[studentIdx].pending.push(task.id); return u; }); next(); };

  // Globale Punkte-Schnelleingabe: Ziffern tippen, Enter = übernehmen + nächster Schüler,
  // Backspace = korrigieren, Esc = verwerfen, Pfeile = blättern
  useEffect(() => {
    const kbBlocked = isOverlayOpen || showMarksEditor || showUnderlineEditor || showNameCapture;
    const onKey = (e) => {
      if (kbBlocked || editingModel) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setPointsBuffer(p => {
          const nextBuf = (p + e.key).slice(0, 4);
          commitBuffer(nextBuf);
          return nextBuf;
        });
      } else if (e.key === ',' || e.key === '.') {
        e.preventDefault();
        setPointsBuffer(p => (p.includes(',') ? p : (p || '0') + ','));
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setPointsBuffer(p => {
          const nextBuf = p.slice(0, -1);
          if (nextBuf) commitBuffer(nextBuf);
          return nextBuf;
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (pointsBuffer) commitBuffer(pointsBuffer);
        setPointsBuffer('');
        if (regions.length > 1 && regionIdx < regions.length - 1) setRegionIdx(i => i + 1);
        else next();
      } else if (e.key === 'Escape') {
        setPointsBuffer('');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault(); setPointsBuffer(''); next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault(); setPointsBuffer(''); prev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pointsBuffer, isOverlayOpen, showMarksEditor, showUnderlineEditor, showNameCapture, editingModel, studentIdx, taskIdx, regionIdx, regions.length]);

  const totalPts = () => getStudentCappedTotal(student, tasks, pointsKey);
  const maxPts = () => getTasksMaxPoints(tasks);
  const graded = students.reduce((c, s) => c + tasks.filter(t => s.grades?.[t.id]?.[pointsKey] !== undefined).length, 0);
  const progress = Math.round((graded / (students.length * tasks.length)) * 100);

  const save = async (auto = false, overrides = {}) => {
    setSaving(true);
    const projectData = { ...project, correctionRole: role, allowSecondViewFirst: !!project.allowSecondViewFirst, students, tasks, gradeTable, correctionMarks, nameField, resumeTask: taskIdx, resumeStudent: studentIdx, scoreFields, taskPointPositions, modelSolutions, modelSolutionOpacity: modelOpacity, diagnosticCatalog, ...overrides };
    if (role === 'second') projectData.progressSecond = progress;
    else projectData.progress = progress;
    try {
      // Save to IndexedDB
      await dbPut(STORE_PROJECTS, { 
        ...projectData, 
        pdfArrayBuffer: undefined, 
        pdfData: undefined 
      });
      // Also save PDF separately if we have it
      if (project.pdfArrayBuffer) {
        await dbPut(STORE_PDFS, { id: project.id, data: project.pdfArrayBuffer });
      }
      onSave(projectData);
      setLastSaved(new Date());
      if (!auto) setToast({ message: 'Projekt gespeichert!', type: 'success' });
    } catch (e) {
      console.error('Save error:', e);
      if (!auto) setToast({ message: 'Speichern fehlgeschlagen!', type: 'error' });
    }
    setSaving(false);
  };

  const showToast = (message, type) => setToast({ message, type });

  if (pdfError) return (
    <div className={`min-h-screen flex items-center justify-center ${darkMode ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-900'}`}>
      <div className={`max-w-md w-full mx-4 p-6 rounded-2xl text-center ${darkMode ? 'bg-gray-900' : 'bg-white shadow'}`}>
        <AlertTriangle className="mx-auto mb-3 text-amber-500" size={36} />
        <h2 className="font-semibold text-lg mb-2">PDF nicht verfügbar</h2>
        <p className={`text-sm mb-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{pdfError}</p>
        <label className="block">
          <span className="px-5 py-2.5 inline-block bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-medium cursor-pointer">PDF neu verknüpfen…</span>
          <input type="file" accept="application/pdf" className="hidden" onChange={e => e.target.files?.[0] && relinkPdf(e.target.files[0])} />
        </label>
        <button onClick={onBack} className={`block mx-auto mt-4 text-sm underline ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Zurück zur Übersicht</button>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
  if (loading) return <div className={`min-h-screen flex items-center justify-center ${darkMode ? 'bg-gray-950' : 'bg-gray-100'}`}><div className="text-center"><div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" /><p className={`${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>PDF wird geladen...</p></div></div>;
  if (!pdfDoc) return <div className={`min-h-screen flex items-center justify-center ${darkMode ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-900'}`}><AlertTriangle size={48} className="text-red-500 mr-4" /><span>PDF konnte nicht geladen werden</span></div>;

  return (
    <div className={`min-h-screen flex flex-col ${darkMode ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-900'}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {showGradeEditor && <GradeTableEditor gradeTable={gradeTable} onChange={setGradeTable} onClose={() => setShowGradeEditor(false)} maxPts={tasks.reduce((a, t) => a + (Number(t.maxPoints) || 0), 0)} darkMode={darkMode} />}
      {showMarksEditor && <CorrectionMarksEditor marks={correctionMarks} onChange={setCorrectionMarks} onClose={() => setShowMarksEditor(false)} darkMode={darkMode} />}
      {showUnderlineEditor && <UnderlineEditorModal entries={underlineEntries} onPatch={(idx, patch) => editingModel ? updateModelAnnAtIndex(idx, patch) : updateAnnAtIndex(idx, patch)} onDelete={(idx) => editingModel ? delModelAnnAtIndex(idx) : delAnnAtIndex(idx)} onClose={() => setShowUnderlineEditor(false)} darkMode={darkMode} />}
      {editingTask && <TaskEditor task={editingTask} onSave={t => { setTasks(ts => ts.map(x => x.id === t.id ? t : x)); }} onClose={() => setEditingTask(null)} darkMode={darkMode} />}
      {showReview && reviewMode === 'task' && (
        <ReviewModal
          students={students}
          tasks={tasks}
          currentTaskId={task?.id}
          currentStudentIndex={studentIdx}
          pointsKey={pointsKey}
          pdfDoc={pdfDoc}
          activeRole={role}
          onClose={() => setShowReview(false)}
          onSwitchMode={() => setReviewMode('student')}
          onOpenSelection={(nextStudentIdx, nextTaskIdx) => {
            if (Number.isInteger(nextTaskIdx)) setTaskIdx(nextTaskIdx);
            if (Number.isInteger(nextStudentIdx)) setStudentIdx(nextStudentIdx);
          }}
          darkMode={darkMode}
        />
      )}
      {showReview && reviewMode === 'student' && (
        <StudentReviewModal pdfDoc={pdfDoc} students={students} tasks={tasks} gradeTable={gradeTable}
          pointsKey={pointsKey} scoreFields={scoreFields} taskPointPositions={taskPointPositions}
          modelSolutions={modelSolutions} initialStudentIdx={studentIdx}
          onClose={() => setShowReview(false)}
          onSwitchMode={() => setReviewMode('task')}
          onSelectStudent={(idx) => setStudentIdx(idx)}
          onSetPoints={reviewSetPoints}
          onSetFinalTotal={setFinalTotal}
          darkMode={darkMode} />
      )}
      {showConflicts && (
        <ConflictModal pdfDoc={pdfDoc} students={students} tasks={tasks} darkMode={darkMode}
          onSetFinal={setFinalPoints} onClose={() => setShowConflicts(false)} />
      )}
      {showOverride && task && region && (
        <RegionOverrideModal pdfDoc={pdfDoc} pageNumber={pageNum()} task={task} regionIndex={regionIdx}
          currentRect={effectiveRect} hasOverride={!!student?.regionOverrides?.[ovKey]}
          hasAnnotations={(student?.annotations?.[annKey] || []).length > 0}
          onSave={r => { setRegionOverride(r); setShowOverride(false); }}
          onReset={() => { setRegionOverride(null); setShowOverride(false); }}
          onClose={() => setShowOverride(false)} darkMode={darkMode} />
      )}
      {showResults && <ResultsModal project={{ ...project, scoreFields, taskPointPositions, correctionRole: role, modelSolutions, modelSolutionOpacity: modelOpacity, diagnosticCatalog, correctionMarks }} students={students} tasks={tasks} gradeTable={gradeTable} pdfDoc={pdfDoc} pdfArrayBuffer={project.pdfArrayBuffer} onClose={() => setShowResults(false)} onToast={showToast} darkMode={darkMode} vaultPassword={vaultPassword} />}
      {showCompletion && <CompletionModal project={project} students={students} tasks={tasks} gradeTable={gradeTable} pointsKey={pointsKey} darkMode={darkMode}

        onClose={() => setShowCompletion(false)}
        onGoToResults={() => { setShowCompletion(false); save(); setShowResults(true); }}
        onBack={() => { save(); onBack(); }} />}
      {showFieldEditor && pdfDoc && <FieldPositionEditor pdfDoc={pdfDoc} pageNumber={student?.pages?.[0]?.pdfPage ?? student?.pageStart ?? 1} tasks={tasks} 
        scoreFields={scoreFields} taskPointPositions={taskPointPositions}
        onSaveScoreFields={setScoreFields} onSaveTaskPointPositions={setTaskPointPositions}
        onClose={() => setShowFieldEditor(false)} darkMode={darkMode} />}
      {showSegEditor && pdfDoc && (
        <SegmentationEditor pdfDoc={pdfDoc} pageCount={project.pageCount} students={students} darkMode={darkMode}
          onClose={() => setShowSegEditor(false)}
          onApply={(newStudents) => {
            setStudents(newStudents);
            setStudentIdx(i => Math.min(i, newStudents.length - 1));
            setShowSegEditor(false);
            save(true, { students: newStudents }); // sofort persistieren
          }} />
      )}
      {showNameCapture && nameField && pdfDoc && (
        <NameCaptureModal
          pdfDoc={pdfDoc}
          students={students}
          nameField={nameField}
          initialIndex={firstUnnamedIndex >= 0 ? firstUnnamedIndex : studentIdx}
          darkMode={darkMode}
          onSaveName={setStudentNameAtIndex}
          onClose={() => setShowNameCapture(false)}
        />
      )}

      <header className={`border-b flex-shrink-0 ${darkMode ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
        <div className="px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button onClick={() => { save(); onBack(); }} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`} title="Zurück zum Dashboard"><ChevronLeft size={20} /></button>
            <div>
              <h1 className="font-semibold">{project.title}</h1>
              <div className="flex items-center gap-3">
                <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                  <span className="text-amber-500 font-medium">{task?.name}</span> • Schüler {studentIdx + 1}/{students.length}
                </p>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${role === 'second'
                  ? 'border-green-500/40 bg-green-500/15 text-green-400'
                  : 'border-red-500/40 bg-red-500/15 text-red-400'}`}
                >{role === 'second' ? 'Zweitkorrektur' : 'Erstkorrektur'}</span>
                {/* Mini progress bar */}
                <div className={`w-24 h-1.5 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-gray-300'}`}>
                  <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-xs text-amber-500">{progress}%</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowReview(true)} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`} title="Review"><Filter size={18} /></button>
            <button onClick={() => setShowResults(true)} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`} title="Ergebnisse & Export"><Award size={18} /></button>

            <button onClick={() => setShowDiagnostics(v => !v)} disabled={editingModel} className={`p-2 rounded-lg transition-colors disabled:opacity-40 ${showDiagnostics ? 'bg-amber-500/20 text-amber-500' : darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`} title={showDiagnostics ? 'Diagnose ausblenden' : 'Diagnose einblenden'}><BarChart3 size={18} /></button>
            {nameField && (
              <button onClick={() => setShowNameCapture(true)} className={`p-2 rounded-lg transition-colors ${showNameCapture ? 'bg-sky-500/20 text-sky-400' : darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`} title="Namen erfassen / überprüfen"><Type size={18} /></button>
            )}

            {/* Musterlösung (Model Solution) */}
            <button
              onClick={() => setShowModelSolution(v => !v)}
              disabled={!modelExists && !editingModel}
              className={`p-2 rounded-lg transition-colors disabled:opacity-40 ${showModelSolution ? 'bg-slate-500/20 text-slate-300' : darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`}
              title={showModelSolution ? 'Musterlösung ausblenden' : 'Musterlösung einblenden'}
            ><FileText size={18} /></button>
            {showModelSolution && modelExists && !editingModel && (
              <div className={`hidden md:flex items-center gap-2 px-2 py-1 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`} title="Musterlösung-Transparenz">
                <span className="text-xs text-gray-500">ML</span>
                <input type="range" min="0.10" max="0.80" step="0.05" value={modelOpacity}
                  onChange={e => setModelOpacity(parseFloat(e.target.value))} className="w-20 accent-slate-400" />
              </div>
            )}
            <button
              onClick={() => { if (role === 'first' && studentIdx === 0) { setEditingModel(v => !v); setShowModelSolution(true); setActiveTool(null); } }}
              disabled={!(role === 'first' && studentIdx === 0)}
              className={`p-2 rounded-lg transition-colors disabled:opacity-40 ${editingModel ? 'bg-slate-500/20 text-slate-300' : darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`}
              title={role === 'first' && studentIdx === 0 ? (editingModel ? 'Musterlösung beenden' : 'Musterlösung erstellen/bearbeiten (nur Schüler 1)') : 'Musterlösung kann nur bei Schüler 1 in der Erstkorrektur erstellt werden'}
            ><Edit3 size={18} /></button>
            <button
              onClick={() => setShowOtherLayer(v => !v)}
              disabled={!canToggleOtherLayer || editingModel}
              className={`p-2 rounded-lg transition-colors disabled:opacity-40 ${showOtherLayer ? 'bg-blue-500/20 text-blue-400' : darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`}
              title={canViewOtherLayer ? (showOtherLayer ? 'Andere Korrektur ausblenden' : 'Andere Korrektur einblenden') : 'Andere Korrektur ist gesperrt'}
            ><Users size={18} /></button>
            <button onClick={() => setDarkMode(!darkMode)} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`}>{darkMode ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button onClick={() => setShowFull(!showFull)} className={`p-2 rounded-lg ${showFull ? 'bg-amber-500/20 text-amber-500' : darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`} title={showFull ? 'Ausschnitt anzeigen' : 'Ganze Seite anzeigen'}><Eye size={18} /></button>
            <button onClick={() => setShowGradeEditor(true)} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`} title="Bewertungstabelle"><Table size={18} /></button>
            <button onClick={() => setShowSegEditor(true)} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`} title="Segmentierung bearbeiten (Seiten drehen, verschieben, Schüler trennen/zusammenführen)"><Scissors size={18} /></button>
            {conflictInfo.total > 0 && (
              <button onClick={() => setShowConflicts(true)}
                className={`px-2.5 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${conflictInfo.open > 0 ? 'bg-violet-600/20 text-violet-400 border border-violet-600' : darkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-200 text-gray-600'}`}
                title="Konflikte zwischen Erst- und Zweitkorrektur">
                <AlertTriangle size={15} />
                {conflictInfo.open > 0 ? `${conflictInfo.open} offen` : 'Konflikte'}
              </button>
            )}
            <button onClick={() => setShowFieldEditor(true)} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`} title="Felder positionieren (Punkte, Note, Aufgaben-BE)"><Settings size={18} /></button>
            <button onClick={() => save()} disabled={saving} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-70">
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              <span className="hidden sm:inline">Speichern</span>
            </button>
            {lastSaved && <span className="text-xs text-gray-500 hidden lg:block">{lastSaved.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Tasks sidebar */}
        <div className={`w-44 border-r overflow-y-auto p-3 ${darkMode ? 'border-gray-800 bg-gray-900/50' : 'border-gray-200 bg-white'}`}>
          <h3 className={`text-xs font-medium mb-2 uppercase tracking-wide ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Aufgaben</h3>
          {tasks.map((t, i) => {
            const done = students.filter(s => s.grades?.[t.id]?.[pointsKey] !== undefined).length;
            return (
              <div key={t.id} className={`p-2 rounded-lg mb-1 transition-colors ${i === taskIdx ? 'bg-amber-500/20 border border-amber-500/50' : darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}`}>
                <div className="flex justify-between items-start">
                  <button onClick={() => { setTaskIdx(i); setStudentIdx(0); }} className="flex-1 text-left text-sm">
                    <span className="font-medium">{t.name}</span>
                    <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>{done}/{students.length} • {t.maxPoints} BE</div>
                    <div className={`mt-1 h-1 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-gray-300'}`}>
                      <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${(done / students.length) * 100}%` }} />
                    </div>
                  </button>
                  <button onClick={() => setEditingTask(t)} className={`p-1 rounded opacity-50 hover:opacity-100 ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}><Edit3 size={12} /></button>
                </div>
              </div>
            );
          })}
          <div className={`mt-3 pt-3 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex justify-between text-sm"><span>Summe</span><span className="font-medium">{totalPts()}/{maxPts()}</span></div>
            <div className="flex justify-between items-center mt-1"><span className="text-sm">Note</span><span className="text-xl font-bold text-amber-500">{formatGradeDisplay(calculateGrade(totalPts(), maxPts(), gradeTable), gradeTable)}</span></div>
          </div>
        </div>

        {/* Main grading area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className={`p-2 border-b flex items-center justify-between flex-wrap gap-2 ${darkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className="flex items-center gap-1">
              <button onClick={() => setZoom(z => Math.max(0.5, z - 0.2))} className={`p-1 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}><ZoomOut size={18} /></button>
              <span className="w-12 text-center text-sm">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(2.5, z + 0.2))} className={`p-1 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}><ZoomIn size={18} /></button>
            </div>
            {!isOverlayOpen && (
            <AnnotationToolbar activeTool={activeTool} setActiveTool={setActiveTool} penColor={penColor} setPenColor={setPenColor} textColor={textColor} setTextColor={setTextColor} textSize={textSize} setTextSize={setTextSize} textOpacity={textOpacity} setTextOpacity={setTextOpacity} markSize={markSize} setMarkSize={setMarkSize} lineWidth={lineWidth} setLineWidth={setLineWidth}
              underlineStyle={underlineStyle} setUnderlineStyle={setUnderlineStyle} underlineDouble={underlineDouble} setUnderlineDouble={setUnderlineDouble} underlineHook={underlineHook} setUnderlineHook={setUnderlineHook} correctionMarks={correctionMarks} selectedMark={selectedMark} setSelectedMark={setSelectedMark}
              onUndo={editingModel ? undoModelAnn : undoAnn} canUndo={(editingModel ? (modelSolutions?.[annKey] || []).length : myAnnotations.length) > 0} darkMode={darkMode} onEditMarks={() => setShowMarksEditor(true)} onEditUnderlines={() => setShowUnderlineEditor(true)} />
            )}
            {regions.length > 1 && !task?.rubric ? (
              <div className="flex items-center gap-2">
                <button onClick={() => setPartPoints(region.id, 0)} disabled={editingModel}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${currentPart === 0 ? 'bg-red-500 text-white' : darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>0</button>
                <input type="text" inputMode="decimal" disabled={editingModel}
                  value={pointsBuffer !== '' ? pointsBuffer : (currentPart ?? '')}
                  onChange={e => {
                    const raw = e.target.value.replace('.', ',');
                    if (/^\d{0,3}(,5?)?$/.test(raw)) {
                      setPointsBuffer(raw);
                      const v = parseFloat(raw.replace(',', '.'));
                      if (!isNaN(v)) setPartPoints(region.id, v);
                    }
                  }}
                  onBlur={() => setPointsBuffer('')}
                  className={`w-20 px-2 py-1.5 text-center rounded-lg border font-mono ${pointsBuffer !== '' ? 'ring-2 ring-amber-500 ' : ''}${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`}
                  placeholder="Teil-BE" />
                <span className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Teil-BE</span>
                <span className={`ml-3 text-sm font-medium ${points === task?.maxPoints ? 'text-green-500' : ''}`}>
                  Σ {formatBE(points ?? 0)}/{task?.maxPoints}
                  {(() => {
                    const sum = Object.values(student?.grades?.[task.id]?.[partsKey] || {}).reduce((a, b) => a + (b || 0), 0);
                    return sum > task.maxPoints ? <span className="text-amber-500"> (gedeckelt)</span> : null;
                  })()}
                </span>
                {!editingModel && checkStampPoints.hasAny && (
                  <div className={`ml-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs ${darkMode ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-700'}`}>
                    <span>Vorschlag (dieser Ausschnitt): {formatHalfPoints(checkStampPoints.suggested)} BE</span>
                    <button type="button" onClick={() => setPartPoints(region.id, checkStampPoints.suggested)}
                      className="px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors">übernehmen</button>
                  </div>
                )}
                <button onClick={() => setShowOverride(true)} disabled={editingModel || pageNum() == null}
                  title="Ausschnitt nur für diesen Schüler anpassen"
                  className={`ml-2 px-3 py-1.5 rounded-lg text-sm ${student?.regionOverrides?.[ovKey] ? 'bg-amber-600/20 text-amber-500 border border-amber-600' : darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>
                  Ausschnitt anpassen{student?.regionOverrides?.[ovKey] ? ' •' : ''}
                </button>
              </div>
            ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => setPoints(0)} disabled={editingModel} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${points === 0 ? 'bg-red-500 text-white' : darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>0 BE</button>
              <input type="text" inputMode="decimal" disabled={editingModel}
                value={pointsBuffer !== '' ? pointsBuffer : (points ?? '')}
                onChange={e => {
                  const raw = e.target.value.replace('.', ',');
                  if (/^\d{0,3}(,5?)?$/.test(raw)) {
                    setPointsBuffer(raw);
                    const v = parseFloat(raw.replace(',', '.'));
                    if (!isNaN(v)) setPoints(Math.round(v * 2) / 2);
                  }
                }}
                onBlur={() => setPointsBuffer('')}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setPointsBuffer(''); e.target.blur(); next(); } }}
                className={`w-20 px-2 py-1.5 text-center rounded-lg border font-mono ${pointsBuffer !== '' ? 'ring-2 ring-amber-500 ' : ''}${isBonusScore(points, task?.maxPoints) ? 'border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-200' : darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} placeholder="BE" />
              <span className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>/{task?.maxPoints}</span>
              <button onClick={() => setPoints(task?.maxPoints)} disabled={editingModel} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${points === task?.maxPoints ? 'bg-green-500 text-white' : darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>volle BE</button>
              {isBonusScore(points, task?.maxPoints) && !editingModel && (
                <div className="ml-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40">
                  Bonus aktiv: +{formatHalfPoints((points || 0) - (task?.maxPoints || 0))} BE
                </div>
              )}
              {!editingModel && checkStampPoints.hasAny && (
                <div className={`ml-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs ${darkMode ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-700'}`}>
                  <span>Vorschlag: {formatHalfPoints(checkStampPoints.suggested)} BE</span>
                  <span className={`${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>({checkStampPoints.full}×✓, {checkStampPoints.half}×½✓)</span>
                  <button
                    type="button"
                    onClick={() => setPoints(checkStampPoints.suggested)}
                    className="px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                  >
                    übernehmen
                  </button>
                </div>
              )}
              <button onClick={() => setShowOverride(true)} disabled={editingModel || pageNum() == null}
                title="Ausschnitt nur für diesen Schüler anpassen"
                className={`ml-2 px-3 py-1.5 rounded-lg text-sm ${student?.regionOverrides?.[ovKey] ? 'bg-amber-600/20 text-amber-500 border border-amber-600' : darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>
                Ausschnitt anpassen{student?.regionOverrides?.[ovKey] ? ' •' : ''}
              </button>
            </div>
            )}
          </div>

          {/* Canvas area */}
          <div className={`flex-1 overflow-hidden flex flex-col ${darkMode ? 'bg-gray-950' : 'bg-gray-300'}`}>
            {regions.length > 1 && (
              <div className={`px-4 pt-2 flex gap-1 flex-wrap items-center border-b ${darkMode ? 'border-gray-800' : 'border-gray-200'}`}>
                {regions.map((r, i) => {
                  const part = student?.grades?.[task.id]?.[partsKey]?.[r.id];
                  return (
                    <button key={r.id} onClick={() => { setRegionIdx(i); setPointsBuffer(''); }}
                      className={`px-3 py-1.5 rounded-t-lg text-sm ${i === regionIdx ? 'bg-amber-600 text-white' : darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>
                      Ausschnitt {i + 1} · S. {r.page}{part !== undefined ? ` · ${formatBE(part)}` : ''}
                    </button>
                  );
                })}
                <span className={`ml-2 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Enter springt zum nächsten Ausschnitt</span>
              </div>
            )}
            {task?.rubric && !editingModel && (
              <RubricPanel task={task}
                selection={student?.grades?.[task.id]?.[rubricKey] || {}}
                onSelect={setRubricLevel} darkMode={darkMode} />
            )}
            <div className="flex-1 p-4 min-h-0">
              {pageNum() == null ? (
                <div className={`h-full flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed ${darkMode ? 'border-gray-800 text-gray-500' : 'border-gray-300 text-gray-500'}`}>
                  <AlertTriangle size={32} className="text-amber-500" />
                  <p>Für diesen Schüler ist auf Blattseite {region?.page} keine Seite vorhanden (fehlend/Platzhalter).</p>
                  <button onClick={() => setShowSegEditor(true)} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-sm font-medium">
                    Segmentierung öffnen
                  </button>
                </div>
              ) : (
              <GradingCanvas pdfDoc={pdfDoc} pageNumber={pageNum()} rotation={pageRotation()} scale={zoom} region={effectiveRect} isCropped={!showFull}
                annotations={displayAnnotations} onAddAnnotation={editingModel ? addModelAnn : addAnn} onDeleteAnnotation={editingModel ? delModelAnn : delAnn}
                activeTool={activeTool} penColor={penColor} textColor={textColor} textSize={textSize} textOpacity={textOpacity} markSize={markSize} lineWidth={lineWidth} underlineStyle={underlineStyle} underlineDouble={underlineDouble} underlineHook={underlineHook} selectedMark={selectedMark} darkMode={darkMode}
                taskPointLabel={task ? { points, maxPoints: task.maxPoints } : null} activeRole={activeCanvasRole} />
              )}
            </div>
            <p className={`text-center py-2 text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              Seite {pageNum() ?? '–'} • {editingModel ? 'Musterlösung' : (student?.name || `Schüler ${studentIdx + 1}`)}
              {student?.pending?.includes(task?.id) && <span className="text-amber-500 ml-2">(übersprungen)</span>}
            </p>
          </div>


          {showDiagnostics && !editingModel && task && (
            <div className="px-4 pb-3 shrink-0">
              <div className={`rounded-xl border ${darkMode ? 'border-gray-800 bg-gray-900/60' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold flex items-center gap-2">
                      <BarChart3 size={16} className="text-amber-500" />
                      Diagnose: Fehlerarten
                    </h3>
                    <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      {diagnosticsCollapsed
                        ? `${selectedDiagnostics.length} markiert • ${catalog.length} Fehlerarten im Katalog`
                        : 'Klick = Fehlerart für diese Aufgabe markieren. Neue Fehlerarten werden sofort in den Katalog dieser Klassenarbeit aufgenommen.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setDiagnosticsCollapsed(v => !v)}
                      className={`px-3 py-2 rounded-lg border text-sm font-medium ${darkMode ? 'bg-gray-800 border-gray-700 hover:bg-gray-700' : 'bg-gray-100 border-gray-300 hover:bg-gray-200'}`}
                    >
                      {diagnosticsCollapsed ? 'Öffnen' : 'Einklappen'}
                    </button>
                  </div>
                </div>

                {!diagnosticsCollapsed && (
                  <div className="px-3 pb-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          value={newErrorLabel}
                          onChange={e => setNewErrorLabel(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDiagnosticType(newErrorLabel, newErrorCompetence); } }}
                          placeholder="Fehlerart hinzufügen…"
                          className={`px-3 py-2 rounded-lg border w-64 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`}
                        />
                        <input
                          value={newErrorCompetence}
                          onChange={e => setNewErrorCompetence(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDiagnosticType(newErrorLabel, newErrorCompetence); } }}
                          placeholder="Kompetenz (optional)…"
                          className={`px-3 py-2 rounded-lg border w-56 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`}
                        />
                        <button
                          onClick={() => addDiagnosticType(newErrorLabel, newErrorCompetence)}
                          className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-2 text-sm font-medium"
                        >
                          <Plus size={16} /> Hinzufügen
                        </button>
                        <button
                          onClick={() => setShowDiagCatalogEditor(true)}
                          title="Fehlerkatalog bearbeiten (umbenennen, Kompetenz ändern, löschen)"
                          className={`px-3 py-2 rounded-lg border text-sm font-medium flex items-center gap-2 ${darkMode ? 'bg-gray-800 border-gray-700 hover:bg-gray-700' : 'bg-gray-100 border-gray-300 hover:bg-gray-200'}`}
                        >
                          <Settings size={16} /> Katalog
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 max-h-28 overflow-y-auto pr-1">
                      <div className="flex flex-wrap gap-2">
                        {catalog.length === 0 && (
                          <span className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Noch keine Fehlerarten – oben eine eingeben oder später während der Korrektur hinzufügen.</span>
                        )}
                        {catalog.map(e => {
                          const selected = selectedDiagnostics.includes(e.id);
                          return (
                            <button
                              key={e.id}
                              onClick={() => toggleDiagnostic(e.id)}
                              title={e.competence ? `Kompetenz: ${e.competence}` : ''}
                              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${selected
                                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                                : darkMode
                                  ? 'bg-gray-800 border-gray-700 hover:bg-gray-700'
                                  : 'bg-gray-100 border-gray-300 hover:bg-gray-200'
                              }`}
                            >
                              {e.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {selectedDiagnostics.length > 0 && (
                      <div className={`mt-3 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                        Markiert für diese Aufgabe: <span className="font-medium">{selectedDiagnostics.length}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}


          {showDiagCatalogEditor && !editingModel && (
            <Modal onClose={() => setShowDiagCatalogEditor(false)}>
              <div className={`rounded-2xl w-[min(920px,95vw)] ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
                <div className={`p-4 border-b flex justify-between items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                  <div>
                    <div className="font-semibold flex items-center gap-2"><Settings size={18} /> Fehlerkatalog bearbeiten</div>
                    <div className={`text-xs mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      Umbenennen, Kompetenz anpassen oder löschen. Löschen entfernt die Fehlerart auch aus allen bisherigen Markierungen dieser Klassenarbeit.
                    </div>
                  </div>
                  <button onClick={() => setShowDiagCatalogEditor(false)} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
                </div>

                <div className="p-4 max-h-[60vh] overflow-y-auto">
                  <div className="grid grid-cols-[1.2fr_1fr_44px] gap-2 mb-2 text-xs text-gray-500 px-1">
                    <span>Fehlerart</span><span>Kompetenz (optional)</span><span></span>
                  </div>

                  {catalog.length === 0 && (
                    <div className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Noch keine Fehlerarten vorhanden.</div>
                  )}

                  {catalog.map((e) => (
                    <div key={e.id} className="grid grid-cols-[1.2fr_1fr_44px] gap-2 mb-2">
                      <input
                        type="text"
                        value={e.label}
                        onChange={ev => updateDiagnosticType(e.id, { label: ev.target.value })}
                        onBlur={() => {
                          const v = (e.label || '').trim();
                          if (!v) {
                            updateDiagnosticType(e.id, { label: '(ohne Bezeichnung)' });
                            showToast('Leere Bezeichnung – zurückgesetzt.', 'warning');
                          } else if (v !== e.label) {
                            updateDiagnosticType(e.id, { label: v });
                          }
                        }}
                        className={`px-3 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`}
                      />
                      <input
                        type="text"
                        value={e.competence || ''}
                        onChange={ev => updateDiagnosticType(e.id, { competence: ev.target.value })}
                        onBlur={() => updateDiagnosticType(e.id, { competence: (e.competence || '').trim() })}
                        placeholder="z. B. Grammatik, Lexik, Kohärenz…"
                        className={`px-3 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`}
                      />
                      <button
                        onClick={() => deleteDiagnosticType(e.id)}
                        className="p-2 hover:bg-red-500/20 rounded text-red-400"
                        title="Löschen"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className={`p-4 border-t flex justify-end ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                  <button onClick={() => setShowDiagCatalogEditor(false)} className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>Schließen</button>
                </div>
              </div>
            </Modal>
          )}
          {/* Bottom navigation */}
          <div className={`p-3 border-t ${darkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className="flex justify-between items-center">
              <input type="text" value={student?.name || ''} onChange={e => setStudents(s => { const u = [...s]; u[studentIdx].name = e.target.value; return u; })}
                placeholder={`Schüler ${studentIdx + 1} – Name eingeben`} className={`px-3 py-2 rounded-lg border w-56 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} />
              <div className="flex gap-2">
                <button onClick={prev} disabled={editingModel || studentIdx === 0} className={`px-4 py-2 rounded-lg disabled:opacity-30 transition-colors ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}><ChevronLeft size={18} /></button>
                <button onClick={skip} disabled={editingModel} title="Überspringen" className={`px-4 py-2 rounded-lg transition-colors ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}><SkipForward size={18} /></button>
                <button onClick={next} disabled={editingModel} className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg flex items-center gap-1 font-medium transition-colors">
                  {isLastStudent && isLastTask ? 'Abschließen' : 'Weiter'}
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Students sidebar */}
        <div className={`w-36 border-l overflow-y-auto p-3 ${darkMode ? 'border-gray-800 bg-gray-900/50' : 'border-gray-200 bg-white'}`}>
          <h3 className={`text-xs font-medium mb-2 uppercase tracking-wide ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Schüler</h3>
          {students.map((s, i) => {
            const p = s.grades?.[task?.id]?.[pointsKey];
            const pending = s.pending?.includes(task?.id);
            return (
              <button key={s.id} onClick={() => { if (!editingModel) setStudentIdx(i); }} className={`w-full p-2 rounded-lg text-left text-sm mb-1 transition-colors ${i === studentIdx ? 'bg-amber-500/20 border border-amber-500/50' : darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-200'} ${pending ? 'opacity-60' : ''}`}>
                <div className="flex justify-between items-center">
                  <span className="truncate">{pending && <SkipForward size={10} className="inline text-amber-500 mr-0.5" />}{s.name || `#${i + 1}`}</span>
                  {p !== undefined && <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${isBonusScore(p, task?.maxPoints) ? 'bg-fuchsia-500/20 text-fuchsia-400' : p === task?.maxPoints ? 'bg-green-500/20 text-green-400' : p === 0 ? 'bg-red-500/20 text-red-400' : darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>{p}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
          <Footer darkMode={darkMode} />
    </div>
  );
}

// ==================== App ====================
export default function App() {
  const [view, setView] = useState('splash');
  const [darkMode, setDarkMode] = useState(true);
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState(null);
  const [dbLoaded, setDbLoaded] = useState(false);

  // ==================== Tresor & Passwortabfrage (Schritt 10) ====================
  const [vaultPassword, setVaultPassword] = useState(null); // nur im Speicher, nie persistiert
  const [showVault, setShowVault] = useState(false);
  const pwResolver = useRef(null);
  const [pwDialog, setPwDialog] = useState(false);
  const requestPassword = () => new Promise(res => { pwResolver.current = res; setPwDialog(true); });

  // Load projects from IndexedDB on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await dbGetAll(STORE_PROJECTS);
        if (stored && stored.length > 0) {
          setProjects(stored);
        }
      } catch (e) {
        console.error('Failed to load from IndexedDB:', e);
      }
      setDbLoaded(true);
    })();
  }, []);

  // Save projects to IndexedDB when they change
  useEffect(() => {
    if (!dbLoaded) return;
    // Only save project metadata, not full PDF data
    projects.forEach(p => {
      dbPut(STORE_PROJECTS, { ...p, pdfArrayBuffer: undefined, pdfData: undefined }).catch(console.error);
    });
  }, [projects, dbLoaded]);

  const handleDelete = async (id) => {
    setProjects(ps => ps.filter(p => p.id !== id));
    try {
      await dbDelete(STORE_PROJECTS, id);
      await dbDelete(STORE_PDFS, id);
    } catch (e) { console.error(e); }
  };

  const handleOpen = async (p) => {
    // Try to load PDF data from IndexedDB
    try {
      const pdfData = await dbGet(STORE_PDFS, p.id);
      setActive(migrateStudentPages(pdfData?.data ? { ...p, pdfArrayBuffer: pdfData.data } : p));
    } catch (e) {
      setActive(migrateStudentPages(p));
    }
    setView('grading');
  };


  const handleImport = async (file) => {
    // ==================== .capyz-Projektdatei (Schritt 10) ====================
    if (file.name.toLowerCase().endsWith('.capyz')) {
      const raw = await importProjectFromZip(file, requestPassword, vaultPassword);
      const project = migrateStudentPages({ ...raw, tasks: migrateTaskRegions(raw.tasks || []) });
      const exists = projects.some(pr => pr.id === project.id);
      const p = exists ? { ...project, id: `p_${Date.now()}`, title: `${project.title} (Import)` } : project;
      if (p.pdfArrayBuffer) {
        try { await dbPut(STORE_PDFS, { id: p.id, data: p.pdfArrayBuffer }); } catch (e) { console.error(e); }
      }
      const meta = { ...p, pdfArrayBuffer: undefined, pdfData: undefined };
      await dbPut(STORE_PROJECTS, meta);
      setProjects(ps => [...ps, meta]);
      return { message: exists ? 'Projekt als Kopie importiert (ID existierte bereits).' : 'Projekt importiert.', type: 'success' };
    }

    const raw = await file.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error('Ungültige JSON-Datei.'); }

    if (data?.type === 'capy-note.second-package.v1') {
      const sourceProjectId = data.sourceProjectId;
      if (!sourceProjectId) throw new Error('Paket ist unvollständig (sourceProjectId fehlt).');

      const existing = projects.find(p => p.correctionRole === 'second' && p.sourceProjectId === sourceProjectId);
      if (existing) {
        const ok = confirm('Es existiert bereits ein Zweitkorrektur-Projekt für diese Klassenarbeit. Soll es ersetzt werden?');
        if (!ok) return { message: 'Import abgebrochen.', type: 'error' };
        await dbDelete(STORE_PROJECTS, existing.id).catch(() => {});
        await dbDelete(STORE_PDFS, existing.id).catch(() => {});
        setProjects(ps => ps.filter(p => p.id !== existing.id));
      }

      const pdfBase64 = data.pdfBase64;
      if (!pdfBase64) throw new Error('Paket ist unvollständig (PDF fehlt).');
      const pdfBuf = base64ToArrayBuffer(pdfBase64);

      const baseProj = data.project || {};
      const newId = `p_${Date.now()}`;
      const proj = {
        id: newId,
        createdAt: Date.now(),
        title: `${baseProj.title || 'Projekt'} – Zweitkorrektur`,
        subject: baseProj.subject || 'Französisch',
        level: baseProj.level || '',
        pagesPerStudent: baseProj.pagesPerStudent || 2,
        pageCount: baseProj.pageCount || 0,
        studentCount: baseProj.studentCount || (data.students?.length || 0),
        tasks: baseProj.tasks || data.tasks || [],
        gradeTable: baseProj.gradeTable || data.gradeTable || [],
        correctionMarks: baseProj.correctionMarks || defaultCorrectionMarks,
        nameField: baseProj.nameField || null,
        scoreFields: baseProj.scoreFields || null,
        taskPointPositions: baseProj.taskPointPositions || {},
        modelSolutions: baseProj.modelSolutions || {},
        modelSolutionOpacity: baseProj.modelSolutionOpacity ?? defaultModelOpacity,
        diagnosticCatalog: baseProj.diagnosticCatalog || [],
        allowSecondViewFirst: !!data.allowSecondViewFirst,
        correctionRole: 'second',
        sourceProjectId,
        students: data.students || [],
        progress: 0,
        progressSecond: 0,
        resumeTask: 0,
        resumeStudent: 0
      };

      await dbPut(STORE_PDFS, { id: proj.id, data: pdfBuf });
      const projM = migrateStudentPages(proj);
      const meta = { ...projM, tasks: migrateTaskRegions(projM.tasks || []), pdfArrayBuffer: undefined, pdfData: undefined };
      await dbPut(STORE_PROJECTS, meta);
      setProjects(ps => [...ps.filter(p => p.id !== meta.id), meta]);
      return { message: 'Zweitkorrektur-Paket importiert.', type: 'success' };
    }

    if (data?.type === 'capy-note.second-results.v1') {
      const sourceProjectId = data.sourceProjectId;
      if (!sourceProjectId) throw new Error('Ergebnis-Datei ist unvollständig (sourceProjectId fehlt).');

      const target = projects.find(p => p.id === sourceProjectId);
      if (!target) throw new Error('Erstprojekt nicht gefunden. Bitte zuerst das Erstprojekt auf diesem PC anlegen/importieren.');

      const importedStudents = data.students || [];
      const hasExistingSecond = (target.students || []).some(s => {
        const g = s.grades || {};
        return Object.values(g).some(v => v && v.secondPoints !== undefined) || Object.values(s.annotations || {}).some(arr => (arr || []).some(a => (a?.role || 'first') === 'second'));
      });
      if (hasExistingSecond) {
        const ok = confirm('Im Erstprojekt existieren bereits Daten der Zweitkorrektur. Diese sollen ersetzt werden?');
        if (!ok) return { message: 'Import abgebrochen.', type: 'error' };
      }

      const mergedStudents = (target.students || []).map(s => {
        const imp = importedStudents.find(x => x.id === s.id);
        const out = { ...s, grades: { ...(s.grades || {}) }, annotations: { ...(s.annotations || {}) } };

        // Clear old second layer if replacing (inkl. alter Final-Entscheidungen)
        Object.keys(out.grades).forEach(tid => {
          if (out.grades[tid]) {
            const copy = { ...out.grades[tid] };
            delete copy.secondPoints;
            delete copy.secondParts;
            delete copy.secondRubric;
            delete copy.finalPoints;
            out.grades[tid] = copy;
          }
        });
        delete out.finalTotal;
        Object.keys(out.annotations).forEach(tid => {
          out.annotations[tid] = (out.annotations[tid] || []).filter(a => (a?.role || 'first') !== 'second');
        });

        if (imp?.grades) {
          for (const [tid, pts] of Object.entries(imp.grades)) {
            out.grades[tid] = { ...(out.grades[tid] || {}), secondPoints: pts };
          }
        }
        if (imp?.secondParts) {
          for (const [tid, sp] of Object.entries(imp.secondParts)) {
            out.grades[tid] = { ...(out.grades[tid] || {}), secondParts: { ...sp } };
          }
        }
        if (imp?.secondRubrics) {
          for (const [tid, sr] of Object.entries(imp.secondRubrics)) {
            out.grades[tid] = { ...(out.grades[tid] || {}), secondRubric: { ...sr } };
          }
        }
        if (imp?.finals) {
          for (const [tid, f] of Object.entries(imp.finals)) {
            out.grades[tid] = { ...(out.grades[tid] || {}), finalPoints: f };
          }
        }
        if (imp?.finalTotal !== undefined) out.finalTotal = imp.finalTotal;
        if (imp?.annotations) {
          for (const [tid, arr] of Object.entries(imp.annotations)) {
            const normalized = (arr || []).map(a => ({ ...a, role: 'second' }));
            out.annotations[tid] = [ ...(out.annotations[tid] || []), ...normalized ];
          }
        }
        return out;
      });

      const updated = { ...target, students: mergedStudents, secondImportedAt: Date.now() };
      const meta = { ...updated, pdfArrayBuffer: undefined, pdfData: undefined };
      await dbPut(STORE_PROJECTS, meta);
      setProjects(ps => ps.map(p => p.id === meta.id ? meta : p));
      return { message: 'Zweitkorrektur-Ergebnis importiert.', type: 'success' };
    }

    throw new Error('Unbekannter Dateityp. (Erwartet: Zweitkorrektur-Paket oder -Ergebnis)');
  };

  if (view === 'splash') return <SplashScreen onFinish={() => setView('dashboard')} />;
  if (view === 'dashboard') return (
    <>
      <Dashboard darkMode={darkMode} setDarkMode={setDarkMode} projects={projects} onNew={() => setView('setup')} onOpen={handleOpen} onDelete={handleDelete} onImport={handleImport}
        onVault={() => setShowVault(true)} vaultUnlocked={!!vaultPassword} />
      {pwDialog && (
        <PasswordDialog title="Projekt entschlüsseln" description="Diese Projektdatei ist verschlüsselt."
          darkMode={darkMode}
          onSubmit={pw => { setPwDialog(false); pwResolver.current?.(pw); }}
          onCancel={() => { setPwDialog(false); pwResolver.current?.(null); }} />
      )}
      {showVault && (
        vaultPassword
          ? <Modal onClose={() => setShowVault(false)}>
              <div className={`rounded-2xl w-[380px] p-6 ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
                <h3 className="font-semibold text-lg mb-2">Tresor entsperrt</h3>
                <p className={`text-sm mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>ZIP-Exporte mit „Tresor-Schlüssel" verwenden dieses Passwort; passende Importe werden automatisch entschlüsselt.</p>
                <div className="flex gap-3">
                  <button onClick={() => setShowVault(false)} className={`flex-1 py-2.5 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Schließen</button>
                  <button onClick={() => { setVaultPassword(null); setShowVault(false); }} className="flex-1 py-2.5 bg-amber-600 text-white rounded-xl font-medium">Tresor sperren</button>
                </div>
              </div>
            </Modal>
          : <PasswordDialog title="Tresor entsperren" confirmInput
              description="Das Tresor-Passwort gilt für diese Sitzung und wird nirgends gespeichert. Es ist der gemeinsame Schlüssel für alle Tresor-Exporte – auf jedem Gerät dasselbe Passwort verwenden."
              darkMode={darkMode}
              onSubmit={pw => { setVaultPassword(pw); setShowVault(false); }}
              onCancel={() => setShowVault(false)} />
      )}
    </>
  );
  if (view === 'setup') return <SetupWizard darkMode={darkMode} onBack={() => setView('dashboard')} onComplete={async d => { 
    const p = { ...d, id: `p_${Date.now()}`, createdAt: Date.now(), progress: 0 };
    // Save PDF data separately
    if (d.pdfArrayBuffer) {
      try { await dbPut(STORE_PDFS, { id: p.id, data: d.pdfArrayBuffer }); } catch (e) { console.error(e); }
    }
    const projectMeta = { ...p, pdfArrayBuffer: undefined, pdfData: undefined };
    setProjects(ps => [...ps, projectMeta]);
    setActive(p);
    setView('grading');
  }} />;
  if (view === 'grading' && active) return <GradingView darkMode={darkMode} setDarkMode={setDarkMode} project={active} vaultPassword={vaultPassword} onSave={u => { 
    const meta = { ...u, pdfArrayBuffer: undefined, pdfData: undefined };
    setProjects(ps => ps.map(p => p.id === u.id ? meta : p)); 
    setActive(u); 
  }} onBack={() => setView('dashboard')} />;
  return null;
}
