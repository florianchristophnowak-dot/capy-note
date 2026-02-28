import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FileUp, ChevronLeft, ChevronRight, Plus, Sun, Moon, Trash2, ZoomIn, ZoomOut, X, Check, Crop, Save, Eye, AlertTriangle, PenTool, Type, Undo2, Table, Edit3, SkipForward, Filter, Eraser, Circle, Download, FileText, Users, Award, BarChart3, CheckCircle2, Clock, Archive, Calendar, PartyPopper, Loader2, Move, AlignCenterVertical, Settings } from 'lucide-react';

// ==================== App Version ====================
const APP_VERSION = '1.2.8';
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

// ==================== PDF.js Loader ====================
const loadPdfJs = async () => {
  if (window.pdfjsLib) return window.pdfjsLib;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      } else reject(new Error('PDF.js not loaded'));
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

// ==================== jsPDF Loader ====================
const loadJsPdf = async () => {
  if (window.jspdf) return window.jspdf;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload = () => {
      if (window.jspdf) resolve(window.jspdf);
      else reject(new Error('jsPDF not loaded'));
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

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
];
const underlineStyles = [
  { id: 'solid', name: 'Durchgezogen', label: '—' },
  { id: 'dashed', name: 'Gestrichelt', label: '- -' },
  { id: 'dotted', name: 'Gepunktet', label: '···' },
  { id: 'wavy', name: 'Wellig', label: '∿' },
];

// ==================== Helpers ====================
const calculateGrade = (points, maxPoints, gradeTable) => {
  if (!gradeTable || maxPoints === 0) return '-';
  const percent = (points / maxPoints) * 100;
  for (const row of gradeTable) {
    if (percent >= row.minPercent) return row.grade;
  }
  return gradeTable[gradeTable.length - 1]?.grade || '-';
};
const isPointsGradeTable = (gradeTable) => {
  if (!Array.isArray(gradeTable)) return false;
  const nums = gradeTable
    .map(r => parseFloat(String(r?.grade ?? '').replace(',', '.')))
    .filter(n => Number.isFinite(n));
  return nums.length ? Math.max(...nums) > 6 : false;
};

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

// ==================== Modal ====================
function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative z-10 max-h-[90vh] overflow-auto animate-modal-in" onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  );
}

// ==================== Grade Table Editor ====================
function GradeTableEditor({ gradeTable, onChange, onClose, darkMode }) {
  const [rows, setRows] = useState([...gradeTable]);
  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[500px] ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className={`p-4 border-b flex justify-between items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <span className="font-semibold">Bewertungstabelle</span>
          <button onClick={onClose} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
        </div>
        <div className="p-4 flex gap-2">
          <button onClick={() => setRows([...defaultGradeTableSekI])} className={`px-3 py-1.5 rounded text-sm ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>Sek I (1-6)</button>
          <button onClick={() => setRows([...defaultGradeTableSekII])} className={`px-3 py-1.5 rounded text-sm ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>Sek II (0-15)</button>
        </div>
        <div className="px-4 pb-4 max-h-[40vh] overflow-y-auto">
          <div className="grid grid-cols-[1fr_1fr_40px] gap-2 mb-2 text-xs text-gray-500 px-1">
            <span>Ab Prozent (%)</span><span>Note</span><span></span>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_40px] gap-2 mb-2">
              <input type="number" value={r.minPercent} onChange={e => { const u = [...rows]; u[i].minPercent = parseFloat(e.target.value) || 0; setRows(u); }} className={`px-3 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} placeholder="Ab %" />
              <input type="text" value={r.grade} onChange={e => { const u = [...rows]; u[i].grade = e.target.value; setRows(u); }} className={`px-3 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} placeholder="Note" />
              <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="p-2 hover:bg-red-500/20 rounded text-red-400"><Trash2 size={16} /></button>
            </div>
          ))}
          <button onClick={() => setRows([...rows, { minPercent: 0, grade: '' }])} className={`w-full py-2 border-2 border-dashed rounded ${darkMode ? 'border-gray-700 hover:border-gray-500' : 'border-gray-300 hover:border-gray-400'}`}><Plus size={16} className="inline" /> Zeile</button>
        </div>
        <div className={`p-4 border-t flex gap-3 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <button onClick={onClose} className={`flex-1 py-2 rounded ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Abbrechen</button>
          <button onClick={() => { onChange([...rows].sort((a, b) => b.minPercent - a.minPercent)); onClose(); }} className="flex-1 py-2 bg-amber-600 text-white rounded font-medium">Speichern</button>
        </div>
      </div>
    </Modal>
  );
}

// ==================== Correction Marks Editor ====================
function CorrectionMarksEditor({ marks, onChange, onClose, darkMode }) {
  const [items, setItems] = useState([...marks]);
  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[500px] ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className={`p-4 border-b flex justify-between items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <span className="font-semibold">Korrekturzeichen</span>
          <button onClick={onClose} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
        </div>
        <div className="p-4 max-h-[50vh] overflow-y-auto">
          {items.map((m, i) => (
            <div key={m.id} className="grid grid-cols-[60px_1fr_50px_40px] gap-2 mb-2">
              <input type="text" maxLength={4} value={m.symbol} onChange={e => { const u = [...items]; u[i].symbol = e.target.value; setItems(u); }} className={`px-2 py-2 rounded border text-center font-bold ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} />
              <input type="text" value={m.name} onChange={e => { const u = [...items]; u[i].name = e.target.value; setItems(u); }} className={`px-3 py-2 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} />
              <input type="color" value={m.color} onChange={e => { const u = [...items]; u[i].color = e.target.value; setItems(u); }} className="w-full h-10 rounded cursor-pointer" />
              <button onClick={() => setItems(items.filter((_, j) => j !== i))} className="p-2 hover:bg-red-500/20 rounded text-red-400"><Trash2 size={16} /></button>
            </div>
          ))}
          <button onClick={() => setItems([...items, { id: `m_${Date.now()}`, symbol: '', name: '', color: '#888888' }])} className={`w-full py-2 border-2 border-dashed rounded ${darkMode ? 'border-gray-700' : 'border-gray-300'}`}><Plus size={16} className="inline" /> Zeichen</button>
        </div>
        <div className={`p-4 border-t flex gap-3 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <button onClick={onClose} className={`flex-1 py-2 rounded ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Abbrechen</button>
          <button onClick={() => { onChange(items.filter(m => m.symbol)); onClose(); }} className="flex-1 py-2 bg-amber-600 text-white rounded font-medium">Speichern</button>
        </div>
      </div>
    </Modal>
  );
}

// ==================== Task Editor ====================
function TaskEditor({ task, onSave, onClose, darkMode }) {
  const [name, setName] = useState(task.name);
  const [maxPoints, setMaxPoints] = useState(task.maxPoints);
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
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className={`flex-1 py-2 rounded ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Abbrechen</button>
          <button onClick={() => { onSave({ ...task, name, maxPoints }); onClose(); }} className="flex-1 py-2 bg-amber-600 text-white rounded font-medium">Speichern</button>
        </div>
      </div>
    </Modal>
  );
}

// ==================== Task Dialog (New) ====================
function TaskDialog({ onSave, onCancel, count, darkMode }) {
  const [name, setName] = useState(`Aufgabe ${count + 1}`);
  const [maxPoints, setMaxPoints] = useState(10);
  return (
    <Modal onClose={onCancel}>
      <div className={`rounded-2xl w-[400px] p-6 ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <h3 className="font-semibold mb-4 text-lg">Neue Aufgabe</h3>
        <div className="space-y-4">
          <div><label className="block text-sm mb-1 font-medium">Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus className={`w-full px-4 py-2 border rounded ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} /></div>
          <div><label className="block text-sm mb-1 font-medium">Maximale BE</label><input type="number" min="0.5" step="0.5" value={maxPoints} onChange={e => setMaxPoints(parseFloat(e.target.value) || 0)} className={`w-full px-4 py-2 border rounded ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} /></div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onCancel} className={`flex-1 py-2 rounded ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>Abbrechen</button>
          <button onClick={() => onSave({ name, maxPoints })} disabled={!name.trim()} className="flex-1 py-2 bg-amber-600 rounded font-medium text-white disabled:opacity-50">Erstellen</button>
        </div>
      </div>
    </Modal>
  );
}

// ==================== Completion Modal ====================
function CompletionModal({ project, students, tasks, gradeTable, pointsKey = 'points', onClose, onGoToResults, onBack, darkMode }) {
  const maxPts = tasks.reduce((s, t) => s + t.maxPoints, 0);
  const getTotal = (s) => tasks.reduce((sum, t) => sum + (s.grades?.[t.id]?.[pointsKey] || 0), 0);
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

// ==================== Review Modal ====================
function ReviewModal({ students, tasks, currentTaskId, pointsKey = 'points', onClose, onSelectStudent, darkMode }) {
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('order');
  const task = tasks.find(t => t.id === currentTaskId);
  if (!task) return null;

  let filtered = students.map((s, idx) => ({ ...s, originalIndex: idx, points: s.grades?.[task.id]?.[pointsKey] }));
  if (filter === 'zero') filtered = filtered.filter(s => s.points === 0);
  else if (filter === 'full') filtered = filtered.filter(s => s.points === task.maxPoints);
  else if (filter === 'pending') filtered = filtered.filter(s => s.pending?.includes(task.id));
  else if (filter === 'ungraded') filtered = filtered.filter(s => s.points === undefined);
  if (sortBy === 'points-asc') filtered.sort((a, b) => (a.points ?? -1) - (b.points ?? -1));
  else if (sortBy === 'points-desc') filtered.sort((a, b) => (b.points ?? -1) - (a.points ?? -1));

  return (
    <Modal onClose={onClose}>
      <div className={`rounded-2xl w-[600px] max-h-[70vh] flex flex-col ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className={`p-4 border-b flex justify-between items-center ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <span className="font-semibold">Review: {task.name}</span>
          <button onClick={onClose} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={20} /></button>
        </div>
        <div className={`p-3 border-b flex gap-2 flex-wrap ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          {[['all', 'Alle'], ['zero', '0 BE'], ['full', 'Volle BE'], ['pending', 'Übersprungen'], ['ungraded', 'Offen']].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${filter === k ? 'bg-amber-600 text-white' : darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>{l}</button>
          ))}
          <div className="ml-auto flex gap-1">
            {[['order', '# Nr.'], ['points-asc', '↑ BE'], ['points-desc', '↓ BE']].map(([k, l]) => (
              <button key={k} onClick={() => setSortBy(k)} className={`px-2 py-1 rounded text-sm ${sortBy === k ? 'bg-blue-600 text-white' : darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? <p className="text-center text-gray-500 py-8">Keine Schüler in diesem Filter</p> : (
            <div className="grid grid-cols-2 gap-2">
              {filtered.map(s => (
                <button key={s.id} onClick={() => { onSelectStudent(s.originalIndex); onClose(); }}
                  className={`p-3 rounded-lg border text-left transition-colors ${darkMode ? 'border-gray-700 bg-gray-800 hover:border-amber-500' : 'border-gray-200 bg-gray-50 hover:border-amber-500'}`}>
                  <div className="flex justify-between">
                    <span className="truncate">{s.name || `Schüler ${s.originalIndex + 1}`}</span>
                    <span className={`font-bold ${s.points === task.maxPoints ? 'text-green-500' : s.points === 0 ? 'text-red-500' : 'text-amber-500'}`}>{s.points ?? '—'}/{task.maxPoints}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ==================== Results/Export Modal ====================
function ResultsModal({ project, students, tasks, gradeTable, pdfDoc, pdfArrayBuffer, onClose, onToast, darkMode }) {
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Musterlösung-Export
  const [includeModelSolution, setIncludeModelSolution] = useState(false);
  const [appendModelPages, setAppendModelPages] = useState(false);
  const [exportModelOpacity, setExportModelOpacity] = useState(project.modelSolutionOpacity ?? defaultModelOpacity);

  const role = project.correctionRole || 'first';
  const pointsKey = role === 'second' ? 'secondPoints' : 'points';
  
  const maxPts = tasks.reduce((s, t) => s + t.maxPoints, 0);
  const getStudentTotal = (s) => tasks.reduce((sum, t) => sum + (s.grades?.[t.id]?.[pointsKey] || 0), 0);
  const getStudentGrade = (s) => formatGradeDisplay(calculateGrade(getStudentTotal(s), maxPts, gradeTable), gradeTable);
  const scoreFields = project.scoreFields || {};
  const modelSolutions = project.modelSolutions || {};


  const ensureCanvasFonts = async () => {
    try {
      if (document?.fonts?.load) {
        await Promise.allSettled([
          document.fonts.load('48px "Gloria Hallelujah"'),
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
    const pageNum = student.pageStart + pageOffset;
    if (pageNum > pdfDoc.numPages) return null;
    
    const page = await pdfDoc.getPage(pageNum);
    const scale = 2;
    const vp = page.getViewport({ scale });
    canvas.width = vp.width;
    canvas.height = vp.height;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    
    // Draw annotations
    tasks.forEach(task => {
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
              ctx.fillStyle = c;
              ctx.font = 'bold 24px sans-serif';
              ctx.fillText(a.symbol, x - 10, y + 8);
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
              ctx.strokeStyle = c;
              ctx.lineWidth = ulw;
              if (a.style === 'wavy') {
                ctx.beginPath();
                const amp = 2 + ulw * 0.3;
                const wl = 6 + ulw * 0.5;
                for (let px = 0; px <= aw; px += 0.5) {
                  const wx = ax + px;
                  const wy = ay + Math.sin((px / wl) * Math.PI * 2) * amp;
                  if (px === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
                }
                ctx.stroke();
              } else {
                if (a.style === 'dashed') ctx.setLineDash([8, 4]);
                else if (a.style === 'dotted') ctx.setLineDash([2, 4]);
                else ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(ax + aw, ay);
                ctx.stroke();
                ctx.setLineDash([]);
              }
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
            ctx.fillStyle = a.color;
            ctx.font = 'bold 24px sans-serif';
            ctx.fillText(a.symbol, x - 10, y + 8);
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
            ctx.strokeStyle = a.color;
            ctx.lineWidth = ulw;
            if (a.style === 'wavy') {
              ctx.beginPath();
              const amp = 2 + ulw * 0.3;
              const wl = 6 + ulw * 0.5;
              for (let px = 0; px <= aw; px += 0.5) {
                const wx = ax + px;
                const wy = ay + Math.sin((px / wl) * Math.PI * 2) * amp;
                if (px === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
              }
              ctx.stroke();
            } else {
              if (a.style === 'dashed') ctx.setLineDash([8, 4]);
              else if (a.style === 'dotted') ctx.setLineDash([2, 4]);
              else ctx.setLineDash([]);
              ctx.beginPath();
              ctx.moveTo(ax, ay);
              ctx.lineTo(ax + aw, ay);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
        });
      }
    });
    
    // Draw task-point labels per task on correct page
    const taskPointPositions = project.taskPointPositions || {};
    tasks.forEach(task => {
      if (task.page === pageOffset + 1) {
        const pts = student.grades?.[task.id]?.[pointsKey];
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
          ctx.fillStyle = pts === task.maxPoints ? '#16a34a' : pts === 0 ? '#dc2626' : '#d97706';
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
        const fs = fitTextSize(ctx, grade, w, h, 'Gloria Hallelujah', '400');
        ctx.font = `400 ${fs}px "Gloria Hallelujah", cursive`;
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
        ctx.font = '400 54px "Gloria Hallelujah", cursive';
        ctx.fillText(grade, bx + 15, by + 102);
      }
    }
    
    return canvas;
  };
    // Render a model-solution-only page (base PDF + Musterlösung)
  const renderModelOnlyPage = async (pageOffset) => {
    if (!pdfDoc) return null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    await ensureCanvasFonts();
    const pageNum = 1 + pageOffset;
    if (pageNum > pdfDoc.numPages) return null;

    const page = await pdfDoc.getPage(pageNum);
    const scale = 2;
    const vp = page.getViewport({ scale });
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
            ctx.fillStyle = c;
            ctx.font = 'bold 24px sans-serif';
            ctx.fillText(a.symbol, x - 10, y + 8);
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
            ctx.strokeStyle = c;
            ctx.lineWidth = ulw;
            if (a.style === 'wavy') {
              ctx.beginPath();
              const amp = 2 + ulw * 0.3;
              const wl = 6 + ulw * 0.5;
              for (let px = 0; px <= aw; px += 0.5) {
                const wx = ax + px;
                const wy = ay + Math.sin((px / wl) * Math.PI * 2) * amp;
                if (px === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
              }
              ctx.stroke();
            } else {
              if (a.style === 'dashed') ctx.setLineDash([8, 4]);
              else if (a.style === 'dotted') ctx.setLineDash([2, 4]);
              else ctx.setLineDash([]);
              ctx.beginPath();
              ctx.moveTo(ax, ay);
              ctx.lineTo(ax + aw, ay);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
        });
      }
    });

    return canvas;
  };


  // Export single student as PDF
  const exportStudentPdf = async (student, index) => {
    try {
      const jspdf = await loadJsPdf();
      const pdf = new jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      
      for (let p = 0; p < project.pagesPerStudent; p++) {
        const canvas = await renderStudentPage(student, p);
        if (!canvas) continue;
        if (p > 0) pdf.addPage();
        
        const imgData = canvas.toDataURL('image/jpeg', 0.85);
        const pdfW = pdf.internal.pageSize.getWidth();
        const pdfH = pdf.internal.pageSize.getHeight();
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH);
      }
      
      // Optional: Musterlösung als Extra-Seiten anhängen
      if (appendModelPages) {
        for (let p = 0; p < project.pagesPerStudent; p++) {
          const canvas = await renderModelOnlyPage(p);
          if (!canvas) continue;
          pdf.addPage();
          const imgData = canvas.toDataURL('image/jpeg', 0.85);
          const pdfW = pdf.internal.pageSize.getWidth();
          const pdfH = pdf.internal.pageSize.getHeight();
          pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH);
        }
      }

      const fileName = `${student.name || `Schueler_${index + 1}`}.pdf`;
      pdf.save(fileName);
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
      const jspdf = await loadJsPdf();
      const pdf = new jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      let firstPage = true;
      
      for (let i = 0; i < students.length; i++) {
        setExportProgress(Math.round((i / students.length) * 100));
        for (let p = 0; p < project.pagesPerStudent; p++) {
          const canvas = await renderStudentPage(students[i], p);
          if (!canvas) continue;
          if (!firstPage) pdf.addPage();
          firstPage = false;
          
          const imgData = canvas.toDataURL('image/jpeg', 0.85);
          const pdfW = pdf.internal.pageSize.getWidth();
          const pdfH = pdf.internal.pageSize.getHeight();
          pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH);
        }
      }
      
      // Optional: Musterlösung einmal am Ende anhängen
      if (appendModelPages) {
        for (let p = 0; p < project.pagesPerStudent; p++) {
          const canvas = await renderModelOnlyPage(p);
          if (!canvas) continue;
          if (!firstPage) pdf.addPage();
          firstPage = false;
          const imgData = canvas.toDataURL('image/jpeg', 0.85);
          const pdfW = pdf.internal.pageSize.getWidth();
          const pdfH = pdf.internal.pageSize.getHeight();
          pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH);
        }
      }

      pdf.save(`${project.title}_Korrigiert.pdf`);
      setExportProgress(100);
      onToast?.('Sammel-PDF erfolgreich exportiert!', 'success');
    } catch (e) {
      console.error('Export error:', e);
      onToast?.('Export fehlgeschlagen: ' + e.message, 'error');
    }
    setExporting(false);
  };
  
  // Export all as individual PDFs
  const exportIndividualPdfs = async () => {
    setExporting(true);
    for (let i = 0; i < students.length; i++) {
      setExportProgress(Math.round((i / students.length) * 100));
      await exportStudentPdf(students[i], i);
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
        ...tasks.map(t => s.grades?.[t.id]?.[pointsKey] ?? ''),
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

  const exportSecondPackage = async () => {
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
          if (!includeFirst) delete out.points;
          // Never prefill secondPoints in a fresh package
          delete out.secondPoints;
          grades[t.id] = out;
        });

        const annotations = {};
        (tasks || []).forEach(t => {
          const arr = (s.annotations?.[t.id] || []).map(normalizeAnnotationRole);
          const filtered = includeFirst ? arr : arr.filter(a => (a?.role || 'first') !== 'first');
          if (filtered.length) annotations[t.id] = filtered;
        });

        return {
          id: s.id,
          name: s.name || '',
          pageStart: s.pageStart,
          grades,
          annotations,
          pending: []
        };
      });

      const pkg = {
        type: 'capy-note.second-package.v1',
        appVersion: APP_VERSION,
        exportedAt: new Date().toISOString(),
        sourceProjectId: project.id,
        allowSecondViewFirst: !!project.allowSecondViewFirst,
        project: {
          title: project.title,
          subject: project.subject,
          level: project.level,
          pagesPerStudent: project.pagesPerStudent,
          pageCount: project.pageCount,
          studentCount: project.studentCount,
          tasks,
          gradeTable,
          correctionMarks: project.correctionMarks || defaultCorrectionMarks,
          scoreFields: project.scoreFields || { totalField: null, gradeField: null },
          taskPointPositions: project.taskPointPositions || {},
          modelSolutions: project.modelSolutions || {},
          modelSolutionOpacity: project.modelSolutionOpacity ?? defaultModelOpacity,
        },
        students: sanitizedStudents,
        pdfBase64: arrayBufferToBase64(pdfArrayBuffer),
      };

      const safeTitle = (project.title || 'Projekt').replace(/[^a-z0-9_\- ]/gi, '').trim().replace(/\s+/g, '_');
      downloadJson(`${safeTitle}_Zweitkorrektur_Paket.json`, pkg);
      onToast?.('Zweitkorrektur-Paket exportiert.', 'success');
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
          (tasks || []).forEach(t => {
            const v = s.grades?.[t.id]?.secondPoints;
            if (v !== undefined) grades[t.id] = v;
          });
          const annotations = {};
          (tasks || []).forEach(t => {
            const arr = (s.annotations?.[t.id] || []).map(normalizeAnnotationRole).filter(a => (a?.role || 'first') === 'second');
            if (arr.length) annotations[t.id] = arr;
          });
          return { id: s.id, name: s.name || '', grades, annotations };
        }),
      };
      const safeTitle = (project.title || 'Projekt').replace(/[^a-z0-9_\- ]/gi, '').trim().replace(/\s+/g, '_');
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
        

        {/* Zweitkorrektur Export/Import */}
        {role === 'first' && (
          <div className={`p-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold">Zweitkorrektur</h3>
                <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Exportiert ein Projektpaket (inkl. PDF) für eine Zweitkorrektur auf einem anderen PC.</p>
              </div>
              <button onClick={exportSecondPackage} disabled={exporting} className="py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
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
                      const pts = s.grades?.[t.id]?.[pointsKey];
                      return (
                        <td key={t.id} className={`py-2 text-center ${pts === t.maxPoints ? 'text-green-500' : pts === 0 ? 'text-red-500' : ''}`}>
                          {pts ?? '—'}
                        </td>
                      );
                    })}
                    <td className="py-2 text-center font-medium">{total}/{maxPts}</td>
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
        const colorClass = r.color === 'green' ? 'border-green-500 bg-green-500/15' : 'border-amber-500 bg-amber-500/15';
        const labelClass = r.color === 'green' ? 'bg-green-500' : 'bg-amber-500';
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

// ==================== Grading Canvas ====================
function GradingCanvas({ pdfDoc, pageNumber, scale, region, isCropped, annotations, onAddAnnotation, onDeleteAnnotation, activeTool, penColor, textColor, textSize, textOpacity, lineWidth, underlineStyle, selectedMark, darkMode, taskPointLabel, scoreLabels, activeRole = 'first' }) {
  const wrapperRef = useRef(null);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState(null);
  const [textPos, setTextPos] = useState(null);
  const [textDraft, setTextDraft] = useState('');
  const textInputRef = useRef(null);

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
  }, [pdfDoc, pageNumber, scale, region, isCropped]);

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
          const vp = page.getViewport({ scale: hiRes });
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
          const vp = page.getViewport({ scale });
          canvas.width = vp.width; canvas.height = vp.height;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
        }
      } catch (e) { console.error(e); }
    })();
  }, [pdfDoc, pageNumber, scale, region, isCropped]);

  const getCoords = useCallback((e) => {
    const r = containerRef.current?.getBoundingClientRect();
    if (!r) return null;
    const x = e.touches?.[0]?.clientX ?? e.clientX;
    const y = e.touches?.[0]?.clientY ?? e.clientY;
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

  const handleStart = useCallback((e) => {
    e.preventDefault();
    const raw = getCoords(e);
    if (!raw) return;

    const local = toLocalCoords(raw);
    // In full-page view, only allow interacting inside the task region
    if (!isCropped && region && !local) return;

    if (activeTool === 'pen') {
      setDrawing(true);
      setCurrentStroke({ type: 'pen', color: penColor, points: [local || raw], lineWidth });
    }
    else if (activeTool === 'underline') {
      setDrawing(true);
      const p = (local || raw);
      setCurrentStroke({ type: 'underline', startX: p.x, startY: p.y, endX: p.x, style: underlineStyle, color: penColor, lineWidth });
    }
    else if (activeTool === 'mark' && selectedMark) {
      const p = local || raw;
      onAddAnnotation?.({ type: 'mark', x: p.x, y: p.y, symbol: selectedMark.symbol, color: selectedMark.color, role: activeRole });
    }
    else if (activeTool === 'text') {
      // keep raw coords for exact cursor preview; we convert to local on submit
      setTextPos(raw);
      setTextDraft('');
    }
    else if (activeTool === 'eraser') {
      const p = local || raw;
      const hit = annotations?.find(a => {
        const r = a?.role || 'first';
        if (r !== activeRole) return false;
        if (a.type === 'pen') return a.points?.some(pt => Math.abs(pt.x - p.x) < 4 && Math.abs(pt.y - p.y) < 4);
        if (a.type === 'mark' || a.type === 'text') return Math.abs(a.x - p.x) < 5 && Math.abs(a.y - p.y) < 5;
        if (a.type === 'underline') return Math.abs(a.y - p.y) < 4 && p.x >= a.x && p.x <= a.x + a.width;
        return false;
      });
      if (hit) onDeleteAnnotation?.(hit);
    }
  }, [activeTool, penColor, lineWidth, underlineStyle, selectedMark, annotations, onAddAnnotation, onDeleteAnnotation, getCoords, toLocalCoords, isCropped, region, activeRole]);

  const handleMove = useCallback((e) => {
    if (!drawing || !currentStroke) return;
    const raw = getCoords(e);
    if (!raw) return;

    const local = toLocalCoords(raw);
    if (!isCropped && region && !local) return;

    const p = local || raw;
    if (currentStroke.type === 'pen') setCurrentStroke(s => ({ ...s, points: [...s.points, p] }));
    else if (currentStroke.type === 'underline') setCurrentStroke(s => ({ ...s, endX: p.x }));
  }, [drawing, currentStroke, getCoords, toLocalCoords, isCropped, region]);

  const handleEnd = useCallback(() => {
    if (!drawing || !currentStroke) return;
    if (currentStroke.type === 'pen' && currentStroke.points.length > 1) onAddAnnotation?.(currentStroke);
    else if (currentStroke.type === 'underline') {
      const w = Math.abs(currentStroke.endX - currentStroke.startX);
      if (w > 2) onAddAnnotation?.({ type: 'underline', x: Math.min(currentStroke.startX, currentStroke.endX), y: currentStroke.startY, width: w, style: currentStroke.style, color: currentStroke.color, lineWidth: currentStroke.lineWidth || 2 });
    }
    setDrawing(false); setCurrentStroke(null);
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

    // Convert local (region) coords to display (page) coords when showing the whole page
    if (!isCropped && region) {
      x1 = region.x + (x1 * region.width) / 100;
      y = region.y + (y * region.height) / 100;
      w = (w * region.width) / 100;
    }

    const x2 = x1 + w;
    const opacity = isPreview ? 0.6 : 1;
    // vectorEffect="non-scaling-stroke" means strokeWidth is in screen pixels
    const lw = (a.lineWidth || 2) * 0.8;
    
    if (a.style === 'wavy') {
      return <path key={`u${i}`} d={wavyPath(x1, y, x2, y, 0.25 + lw * 0.06, 0.8 + lw * 0.05)} fill="none" stroke={a.color} strokeWidth={lw} opacity={opacity} vectorEffect="non-scaling-stroke" />;
    }
    const dashProps = {};
    if (a.style === 'dashed') dashProps.strokeDasharray = `${lw * 4} ${lw * 2}`;
    else if (a.style === 'dotted') dashProps.strokeDasharray = `${lw * 0.5} ${lw * 2}`;
    return <line key={`u${i}`} x1={x1} y1={y} x2={x2} y2={y} stroke={a.color} strokeWidth={lw} opacity={opacity} vectorEffect="non-scaling-stroke" {...dashProps} />;
  };

  return (
    <div ref={wrapperRef} className="w-full h-full flex items-center justify-center">
      <div ref={containerRef} className={`relative select-none touch-none ${activeTool ? 'cursor-crosshair' : ''}`}
        onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd}
        onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}>
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
            lineWidth: currentStroke.lineWidth
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
          return (
            <div key={`m${i}`} className="absolute pointer-events-none text-xs font-bold px-1 rounded" style={{ left: `${p.x}%`, top: `${p.y}%`, backgroundColor: `${a.color}25`, color: a.color, transform: 'translate(-50%, -50%)', border: `1.5px solid ${a.color}50` }}>{a.symbol}</div>
          );
        })}
        {/* Task point label at top-right of cropped region */}
        {taskPointLabel && isCropped && (
          <div className="absolute top-2 right-2 pointer-events-none">
            <div className={`px-2.5 py-1 rounded-lg text-sm font-bold shadow-lg ${
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
function AnnotationToolbar({ activeTool, setActiveTool, penColor, setPenColor, textColor, setTextColor, textSize, setTextSize, textOpacity, setTextOpacity, lineWidth, setLineWidth, underlineStyle, setUnderlineStyle, correctionMarks, selectedMark, setSelectedMark, onUndo, canUndo, darkMode }) {
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
    // showSize is only relevant for pen/underline; close it when leaving those.
    if (activeTool !== 'pen' && activeTool !== 'underline') setShowSize(false);
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
          <button onClick={() => setShowSize(!showSize)} title="Stift-/Unterstreichungsgröße" className={`p-2 rounded-lg ${showSize ? (darkMode ? 'bg-gray-700' : 'bg-gray-300') : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-300'}`}><Circle size={16} /></button>
          {showSize && (
            <div className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 p-3 rounded-xl shadow-xl z-50 whitespace-nowrap ${darkMode ? 'bg-gray-700 border border-gray-600' : 'bg-white border border-gray-200'}`}>
              <div className="text-xs text-gray-400 mb-1.5">Stift & Unterstreichungen</div>
              <div className="flex items-center gap-2">
                <input type="range" min="1" max="8" value={lineWidth} onChange={e => setLineWidth(+e.target.value)} className="w-24 accent-amber-500" />
                <span className="text-sm font-mono w-6 text-right">{lineWidth}</span>
              </div>
              <div className="mt-2 flex items-center gap-1">
                <svg width="80" height="16" viewBox="0 0 80 16"><line x1="4" y1="8" x2="76" y2="8" stroke={penColor} strokeWidth={lineWidth * 0.8} strokeLinecap="round" /></svg>
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
      </div>

      <div className={`flex gap-1 px-2 border-r ${darkMode ? 'border-gray-600' : 'border-gray-300'}`}>
        {correctionMarks.slice(0, 6).map(m => (
          <button key={m.id} onClick={() => { if (activeTool === 'mark' && selectedMark?.id === m.id) { setActiveTool(null); } else { setActiveTool('mark'); setSelectedMark(m); } }} title={m.name} className={`px-1.5 py-1 rounded text-xs font-bold transition-colors ${activeTool === 'mark' && selectedMark?.id === m.id ? 'ring-2' : ''}`} style={{ backgroundColor: `${m.color}25`, color: m.color, borderColor: activeTool === 'mark' && selectedMark?.id === m.id ? m.color : 'transparent' }}>{m.symbol}</button>
        ))}
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
function Dashboard({ darkMode, setDarkMode, projects, onNew, onOpen, onDelete, onImport }) {
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
      <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { const res = await onImport?.(f); if (res) setToast(res); } catch (err) { console.error(err); setToast({ message: err?.message || 'Import fehlgeschlagen', type: 'error' }); } }} />
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
  const [gradeTable, setGradeTable] = useState([...defaultGradeTableSekI]);
  const [correctionMarks, setCorrectionMarks] = useState([...defaultCorrectionMarks]);
  const [tasks, setTasks] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectionMode, setSelectionMode] = useState(null);
  const [pendingRegion, setPendingRegion] = useState(null);
  const [zoom, setZoom] = useState(0.9);
  const [showGradeEditor, setShowGradeEditor] = useState(false);
  const [showMarksEditor, setShowMarksEditor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scoreFields, setScoreFields] = useState({ totalField: null, gradeField: null });
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
      const useDemo = confirm('PDF konnte nicht geladen werden. Demo-Modus verwenden?');
      if (useDemo) startDemo();
    } finally { setLoading(false); }
  };

  const startDemo = () => {
    const demo = createDemoPdf(8);
    setPdfFile({ name: 'Demo.pdf' }); setPdfDoc(demo); setPdfArrayBuffer(null); setPageCount(8); setTitle('Demo-Klassenarbeit'); setStep(2);
  };

  const saveTask = (data) => { setTasks([...tasks, { id: `t_${Date.now()}`, ...data, page: pendingRegion.page, region: pendingRegion }]); setPendingRegion(null); };

  const finish = () => {
    if (!tasks.length) return alert('Bitte mindestens eine Aufgabe definieren.');
    const students = Array.from({ length: studentCount }, (_, i) => ({ id: `s_${i}`, name: '', pageStart: i * pagesPerStudent + 1, grades: {}, annotations: {}, pending: [] }));
    onComplete({ 
      title, subject, level, gradeTable, correctionMarks, pagesPerStudent, 
      pdfName: pdfFile.name, pageCount, studentCount, tasks, students, 
      pdfArrayBuffer, scoreFields, allowSecondViewFirst,
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
      {showGradeEditor && <GradeTableEditor gradeTable={gradeTable} onChange={setGradeTable} onClose={() => setShowGradeEditor(false)} darkMode={darkMode} />}
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
            <Table className="text-amber-500 mb-2" /><p className="font-medium">Bewertungstabelle</p><p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>{gradeTable.length} Stufen</p>
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
            Korrektur starten ({tasks.length} {tasks.length === 1 ? 'Aufgabe' : 'Aufgaben'})
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
            {tasks.length === 0 && !selectionMode && (
              <div className={`p-4 rounded-lg text-sm text-center ${darkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                Noch keine Aufgaben definiert. Klicken Sie „Markieren" und ziehen Sie einen Bereich auf dem PDF.
              </div>
            )}
            {tasks.map((t, i) => (
              <div key={t.id} className={`p-3 rounded-lg border mb-2 ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
                <div className="flex justify-between">
                  <div><p className="font-medium">{t.name}</p><p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Seite {t.page} • {t.maxPoints} BE</p></div>
                  <button onClick={() => setTasks(tasks.filter((_, j) => j !== i))} className="p-1 hover:bg-red-500/20 rounded text-red-400"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
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
                    ...tasks.filter(t => t.page === currentPage).map(t => ({ ...t.region, name: t.name, color: 'amber' })),
                    ...(scoreFields.totalField && currentPage === 1 ? [{ ...scoreFields.totalField, name: 'Punkte', color: 'green' }] : []),
                    ...(scoreFields.gradeField && currentPage === 1 ? [{ ...scoreFields.gradeField, name: 'Note', color: 'green' }] : [])
                  ]}
                  selectionMode={!!selectionMode}
                  onSelect={r => {
                    if (selectionMode === 'task') {
                      setPendingRegion({ ...r, page: currentPage, type: 'task' });
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

// ==================== Grading ====================
function GradingView({ darkMode, setDarkMode, project, onSave, onBack }) {
  const role = project.correctionRole || 'first';
  const pointsKey = role === 'second' ? 'secondPoints' : 'points';
  const otherRole = role === 'second' ? 'first' : 'second';

  const [pdfDoc, setPdfDoc] = useState(null);
  const [students, setStudents] = useState(project.students || []);
  const [tasks, setTasks] = useState(project.tasks || []);
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
  const lastPenColorRef = useRef(role === 'second' ? '#22c55e' : '#ef4444');
  const [lineWidth, setLineWidth] = useState(3);
  const [underlineStyle, setUnderlineStyle] = useState('solid');

  // If the user hasn't chosen a dedicated text color, keep it in sync with the pen color
  useEffect(() => {
    if (textColor === lastPenColorRef.current) setTextColor(penColor);
    lastPenColorRef.current = penColor;
  }, [penColor]);
  const [selectedMark, setSelectedMark] = useState(null);
  const [showOtherLayer, setShowOtherLayer] = useState(false);
  const [gradeTable, setGradeTable] = useState(project.gradeTable || defaultGradeTableSekI);
  const [showGradeEditor, setShowGradeEditor] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [showReview, setShowReview] = useState(false);
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

  const task = tasks[taskIdx];
  const student = students[studentIdx];

  const modelAnnsRaw = (modelSolutions?.[task?.id] || []).map(a => ({ ...a, role: MODEL_ROLE }));
  const modelExists = modelAnnsRaw.length > 0;

  const allAnnotations = student?.annotations?.[task?.id] || [];
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
  const activeCanvasRole = editingModel ? MODEL_ROLE : role;

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
    (async () => {
      try {
        if (project.pdfArrayBuffer) {
          const lib = await loadPdfJs();
          setPdfDoc(await lib.getDocument({ data: project.pdfArrayBuffer.slice(0) }).promise);
        } else if (project.pdfData?.arrayBuffer) {
          const lib = await loadPdfJs();
          setPdfDoc(await lib.getDocument({ data: await project.pdfData.arrayBuffer() }).promise);
        } else {
          setPdfDoc(createDemoPdf(project.pageCount || 8));
        }
      } catch (e) { setPdfDoc(createDemoPdf(project.pageCount || 8)); }
      finally { setLoading(false); }
    })();
  }, [project]);

  // Auto-save every 2 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      save(true);
    }, 120000);
    return () => clearInterval(interval);
  }, [students, tasks, gradeTable, taskIdx, studentIdx]);

  const pageNum = () => student ? student.pageStart + (task?.page || 1) - 1 : 1;
  const points = student?.grades?.[task?.id]?.[pointsKey];
  const otherPointsKey = role === 'second' ? 'points' : 'secondPoints';
  const hasOtherLayerHere = !!student?.grades?.[task?.id]?.[otherPointsKey] || allAnnotations.some(a => (a?.role || 'first') === otherRole);
  const canViewOtherLayer = role === 'first' ? true : !!project.allowSecondViewFirst;
  const canToggleOtherLayer = canViewOtherLayer && hasOtherLayerHere;
  const isOverlayOpen = showReview || showResults || showCompletion || showGradeEditor || showFieldEditor || !!editingTask;


  useEffect(() => {
    if (!canViewOtherLayer) setShowOtherLayer(false);
  }, [canViewOtherLayer]);

  const setPoints = (p) => setStudents(s => {
    const u = [...s];
    if (!u[studentIdx].grades) u[studentIdx].grades = {};
    const prev = u[studentIdx].grades[task.id] || {};
    u[studentIdx].grades[task.id] = { ...prev, [pointsKey]: Math.min(p, task.maxPoints) };
    if (u[studentIdx].pending) u[studentIdx].pending = u[studentIdx].pending.filter(id => id !== task.id);
    return u;
  });

  const addAnn = (a) => setStudents(s => {
    const u = [...s];
    if (!u[studentIdx].annotations) u[studentIdx].annotations = {};
    if (!u[studentIdx].annotations[task.id]) u[studentIdx].annotations[task.id] = [];
    u[studentIdx].annotations[task.id] = [...u[studentIdx].annotations[task.id], { ...a, role }];
    return u;
  });
  const delAnn = (a) => setStudents(s => {
    const u = [...s];
    if (u[studentIdx].annotations?.[task.id]) u[studentIdx].annotations[task.id] = u[studentIdx].annotations[task.id].filter(x => x !== a);
    return u;
  });
  const undoAnn = () => setStudents(s => {
    const u = [...s];
    const arr = u[studentIdx].annotations?.[task.id] || [];
    if (!arr.length) return u;
    // remove last annotation of current role
    let idx = -1;
    for (let i = arr.length - 1; i >= 0; i--) {
      if ((arr[i]?.role || 'first') === role) { idx = i; break; }
    }
    if (idx === -1) return u;
    u[studentIdx].annotations[task.id] = [...arr.slice(0, idx), ...arr.slice(idx + 1)];
    return u;
  });


  // Musterlösung-Annotationen
  const addModelAnn = (a) => setModelSolutions(ms => {
    const out = { ...(ms || {}) };
    const arr = out[task.id] ? [...out[task.id]] : [];
    out[task.id] = [...arr, { ...a, role: MODEL_ROLE }];
    return out;
  });

  const delModelAnn = (a) => setModelSolutions(ms => {
    const out = { ...(ms || {}) };
    out[task.id] = (out[task.id] || []).filter(x => x !== a);
    return out;
  });

  const undoModelAnn = () => setModelSolutions(ms => {
    const out = { ...(ms || {}) };
    const arr = out[task.id] || [];
    if (!arr.length) return out;
    out[task.id] = arr.slice(0, -1);
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

  const totalPts = () => tasks.reduce((s, t) => s + (student?.grades?.[t.id]?.[pointsKey] || 0), 0);
  const maxPts = () => tasks.reduce((s, t) => s + t.maxPoints, 0);
  const graded = students.reduce((c, s) => c + tasks.filter(t => s.grades?.[t.id]?.[pointsKey] !== undefined).length, 0);
  const progress = Math.round((graded / (students.length * tasks.length)) * 100);

  const save = async (auto = false) => {
    setSaving(true);
    const projectData = { ...project, correctionRole: role, allowSecondViewFirst: !!project.allowSecondViewFirst, students, tasks, gradeTable, resumeTask: taskIdx, resumeStudent: studentIdx, scoreFields, taskPointPositions, modelSolutions, modelSolutionOpacity: modelOpacity };
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

  if (loading) return <div className={`min-h-screen flex items-center justify-center ${darkMode ? 'bg-gray-950' : 'bg-gray-100'}`}><div className="text-center"><div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" /><p className={`${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>PDF wird geladen...</p></div></div>;
  if (!pdfDoc) return <div className={`min-h-screen flex items-center justify-center ${darkMode ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-900'}`}><AlertTriangle size={48} className="text-red-500 mr-4" /><span>PDF konnte nicht geladen werden</span></div>;

  return (
    <div className={`min-h-screen flex flex-col ${darkMode ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-900'}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {showGradeEditor && <GradeTableEditor gradeTable={gradeTable} onChange={setGradeTable} onClose={() => setShowGradeEditor(false)} darkMode={darkMode} />}
      {editingTask && <TaskEditor task={editingTask} onSave={t => { setTasks(ts => ts.map(x => x.id === t.id ? t : x)); }} onClose={() => setEditingTask(null)} darkMode={darkMode} />}
      {showReview && <ReviewModal students={students} tasks={tasks} currentTaskId={task?.id} pointsKey={pointsKey} onClose={() => setShowReview(false)} onSelectStudent={setStudentIdx} darkMode={darkMode} />}
      {showResults && <ResultsModal project={{ ...project, scoreFields, taskPointPositions, correctionRole: role, modelSolutions, modelSolutionOpacity: modelOpacity }} students={students} tasks={tasks} gradeTable={gradeTable} pdfDoc={pdfDoc} pdfArrayBuffer={project.pdfArrayBuffer} onClose={() => setShowResults(false)} onToast={showToast} darkMode={darkMode} />}
      {showCompletion && <CompletionModal project={project} students={students} tasks={tasks} gradeTable={gradeTable} pointsKey={pointsKey} darkMode={darkMode}

        onClose={() => setShowCompletion(false)}
        onGoToResults={() => { setShowCompletion(false); save(); setShowResults(true); }}
        onBack={() => { save(); onBack(); }} />}
      {showFieldEditor && pdfDoc && <FieldPositionEditor pdfDoc={pdfDoc} pageNumber={student?.pageStart || 1} tasks={tasks} 
        scoreFields={scoreFields} taskPointPositions={taskPointPositions}
        onSaveScoreFields={setScoreFields} onSaveTaskPointPositions={setTaskPointPositions}
        onClose={() => setShowFieldEditor(false)} darkMode={darkMode} />}

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
            <AnnotationToolbar activeTool={activeTool} setActiveTool={setActiveTool} penColor={penColor} setPenColor={setPenColor} textColor={textColor} setTextColor={setTextColor} textSize={textSize} setTextSize={setTextSize} textOpacity={textOpacity} setTextOpacity={setTextOpacity} lineWidth={lineWidth} setLineWidth={setLineWidth}
              underlineStyle={underlineStyle} setUnderlineStyle={setUnderlineStyle} correctionMarks={project.correctionMarks || defaultCorrectionMarks} selectedMark={selectedMark} setSelectedMark={setSelectedMark}
              onUndo={editingModel ? undoModelAnn : undoAnn} canUndo={(editingModel ? (modelSolutions?.[task?.id] || []).length : myAnnotations.length) > 0} darkMode={darkMode} />
            )}
            <div className="flex items-center gap-2">
              <button onClick={() => setPoints(0)} disabled={editingModel} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${points === 0 ? 'bg-red-500 text-white' : darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>0 BE</button>
<input type="number" disabled={editingModel} min="0" max={task?.maxPoints} step="0.5" value={points ?? ''} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setPoints(v); }}
                className={`w-16 px-2 py-1.5 text-center rounded-lg border font-mono ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300'}`} placeholder="BE" />
              <span className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>/{task?.maxPoints}</span>
              <button onClick={() => setPoints(task?.maxPoints)} disabled={editingModel} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${points === task?.maxPoints ? 'bg-green-500 text-white' : darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'}`}>volle BE</button>
            </div>
          </div>

          {/* Canvas area */}
          <div className={`flex-1 overflow-hidden flex flex-col ${darkMode ? 'bg-gray-950' : 'bg-gray-300'}`}>
            <div className="flex-1 p-4 min-h-0">
              <GradingCanvas pdfDoc={pdfDoc} pageNumber={pageNum()} scale={zoom} region={task?.region} isCropped={!showFull}
                annotations={displayAnnotations} onAddAnnotation={editingModel ? addModelAnn : addAnn} onDeleteAnnotation={editingModel ? delModelAnn : delAnn}
                activeTool={activeTool} penColor={penColor} textColor={textColor} textSize={textSize} textOpacity={textOpacity} lineWidth={lineWidth} underlineStyle={underlineStyle} selectedMark={selectedMark} darkMode={darkMode}
                taskPointLabel={task ? { points, maxPoints: task.maxPoints } : null} activeRole={activeCanvasRole} />
            </div>
            <p className={`text-center py-2 text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              Seite {pageNum()} • {editingModel ? 'Musterlösung' : (student?.name || `Schüler ${studentIdx + 1}`)}
              {student?.pending?.includes(task?.id) && <span className="text-amber-500 ml-2">(übersprungen)</span>}
            </p>
          </div>

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
                  {p !== undefined && <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${p === task?.maxPoints ? 'bg-green-500/20 text-green-400' : p === 0 ? 'bg-red-500/20 text-red-400' : darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>{p}</span>}
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
      if (pdfData?.data) {
        setActive({ ...p, pdfArrayBuffer: pdfData.data });
      } else {
        setActive(p);
      }
    } catch (e) {
      setActive(p);
    }
    setView('grading');
  };


  const handleImport = async (file) => {
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
        scoreFields: baseProj.scoreFields || null,
        taskPointPositions: baseProj.taskPointPositions || {},
        modelSolutions: baseProj.modelSolutions || {},
        modelSolutionOpacity: baseProj.modelSolutionOpacity ?? defaultModelOpacity,
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
      const meta = { ...proj, pdfArrayBuffer: undefined, pdfData: undefined };
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

        // Clear old second layer if replacing
        Object.keys(out.grades).forEach(tid => {
          if (out.grades[tid]) {
            const copy = { ...out.grades[tid] };
            delete copy.secondPoints;
            out.grades[tid] = copy;
          }
        });
        Object.keys(out.annotations).forEach(tid => {
          out.annotations[tid] = (out.annotations[tid] || []).filter(a => (a?.role || 'first') !== 'second');
        });

        if (imp?.grades) {
          for (const [tid, pts] of Object.entries(imp.grades)) {
            out.grades[tid] = { ...(out.grades[tid] || {}), secondPoints: pts };
          }
        }
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
  if (view === 'dashboard') return <Dashboard darkMode={darkMode} setDarkMode={setDarkMode} projects={projects} onNew={() => setView('setup')} onOpen={handleOpen} onDelete={handleDelete} onImport={handleImport} />;
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
  if (view === 'grading' && active) return <GradingView darkMode={darkMode} setDarkMode={setDarkMode} project={active} onSave={u => { 
    const meta = { ...u, pdfArrayBuffer: undefined, pdfData: undefined };
    setProjects(ps => ps.map(p => p.id === u.id ? meta : p)); 
    setActive(u); 
  }} onBack={() => setView('dashboard')} />;
  return null;
}
