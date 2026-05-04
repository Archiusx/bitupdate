<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth, signInWithPopup, signInWithRedirect, getRedirectResult,
    GoogleAuthProvider, signInAnonymously, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore, collection, addDoc, onSnapshot, serverTimestamp,
    doc, updateDoc, getDoc, setDoc, arrayUnion, query,
    orderBy, limit
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
    getDatabase, ref as rtdbRef, push, onValue, update as rtdbUpdate,
    remove as rtdbRemove, get as rtdbGet, query as rtdbQuery,
    orderByChild as rtdbOrderByChild, limitToLast
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

// ── CONFIG ────────────────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyDAwty9lfGsj-hAf1QffMJLtvUfhdd_SPI",
    authDomain: "loginx-897b3.firebaseapp.com",
    databaseURL: "https://loginx-897b3-default-rtdb.firebaseio.com",
    projectId: "loginx-897b3",
    storageBucket: "loginx-897b3.firebasestorage.app",
    messagingSenderId: "380291415413",
    appId: "1:380291415413:web:6d222db905e4457e29e73c",
    measurementId: "G-BM6PMDKN5V"
};

const ADMIN_EMAILS          = ["co.2024.prdeshkar@bitwardha.ac.in", "class11art@gmail.com"];
const TICKETS_COLLECTION    = "support_tickets";
const ANNOUNCEMENTS_COLLECTION = "public_announcements";
const USERS_COLLECTION      = "users";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const rtdb = getDatabase(app);

// ── STATE ─────────────────────────────────────────────────────────────
let currentUser         = null;
let userCache           = {};
let isAdmin             = false;
let allTickets          = [];
let allUpdates          = [];
let currentStatusFilter = 'all';
let currentView         = 'about';
let editTicketId        = null;
let unsubTickets        = null;
let unsubAnnounce       = null;
let assignCallback      = null;
let ticketsReady        = false;

// ── IMAGE UPLOAD STATE ────────────────────────────────────────────────
let pendingImageFile = null;
let pendingImageURL  = null;
const uploadQueue    = [];
let activeUploads    = 0;
const MAX_CONCURRENT = 2;
const MAX_RETRIES    = 3;
const RETRY_DELAYS   = [2000, 5000, 12000];
const uploadLog      = [];
const USER_RATE_LIMIT = 5;
const RATE_WINDOW_MS  = 60_000;

// ── ANNOUNCEMENT STATE ────────────────────────────────────────────────
let currentAnnTab = 'text';
let annImgFile    = null;
let annImgURL     = null;

// ── NOTIFICATION STATE ────────────────────────────────────────────────
let notifications   = JSON.parse(localStorage.getItem('bitup_notifs') || '[]');
let _prevTicketIds  = new Set();
let _firstTicketLoad = true;

// ── TICKET RENDER CACHE ───────────────────────────────────────────────
const VISIBLE_CHUNK      = 15;
let   _renderedCount     = 0;
const _cachedTicketHTML  = new Map();

// ── TICKET PERSISTENCE CACHE (instant load before Firebase responds) ──
const TICKET_CACHE_KEY = 'bitup_tickets_v1';
function _saveTicketCache(tickets) {
    try { localStorage.setItem(TICKET_CACHE_KEY, JSON.stringify(tickets)); } catch(e) {}
}
function _loadTicketCache() {
    try { const s = localStorage.getItem(TICKET_CACHE_KEY); return s ? JSON.parse(s) : null; } catch(e) { return null; }
}
(function _primeFromCache() {
    const cached = _loadTicketCache();
    if (cached && cached.length) {
        allTickets   = cached;
        ticketsReady = true;
    }
})();

// ── CLOUDINARY ────────────────────────────────────────────────────────
const CLOUDINARY_CLOUD  = 'dzepoqldk';
const CLOUDINARY_PRESET = 'bit_updates';
const CLOUDINARY_URL    = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`;

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════
function escHTML(s) {
    if (!s) return '';
    return String(s).replace(/[&<>'"]/g, t => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[t]||t));
}
function timeAgo(ts) {
    if (!ts) return 'just now';
    const s = Math.floor((Date.now() - (ts?.toMillis ? ts.toMillis() : ts)) / 1000);
    if (s < 60)    return 'just now';
    if (s < 3600)  return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
}
function catColor(cat) {
    const m = {
        Academic:'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        Exam:    'bg-purple-500/20 text-purple-400 border-purple-500/30',
        Technical:'bg-amber-500/20 text-amber-400 border-amber-500/30',
        Circular:'bg-blue-500/20 text-blue-400 border-blue-500/30',
        General: 'bg-slate-700/60 text-slate-300 border-slate-600',
        Other:   'bg-rose-500/20 text-rose-400 border-rose-500/30'
    };
    return m[cat] || 'bg-slate-700/60 text-slate-300 border-slate-600';
}
function catIcon(cat) {
    const m = {Academic:'fa-book',Exam:'fa-graduation-cap',Technical:'fa-wrench',
               Circular:'fa-file-lines',General:'fa-circle-dot',Other:'fa-triangle-exclamation'};
    return m[cat] || 'fa-tag';
}
function statusColor(s) {
    return s === 'closed'
        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
        : 'bg-amber-500/20 text-amber-400 border-amber-500/30';
}

// ═══════════════════════════════════════════════════════════════════════
// IMAGE UPLOAD ENGINE — Cloudinary + load balancer + throttle + retry
// ═══════════════════════════════════════════════════════════════════════
function validateImageFile(file) {
    const ALLOWED = ['image/jpeg','image/png','image/webp','image/gif'];
    if (!ALLOWED.includes(file.type)) return 'Only JPG, PNG, WEBP or GIF allowed.';
    if (file.size > 5 * 1024 * 1024) return `Image must be under 5 MB (${(file.size/1048576).toFixed(1)} MB).`;
    return null;
}
function isRateLimited() {
    const now = Date.now();
    while (uploadLog.length && now - uploadLog[0] > RATE_WINDOW_MS) uploadLog.shift();
    return uploadLog.length >= USER_RATE_LIMIT;
}
function compressImage(file, maxPx = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
        const img = new Image(), url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let {width, height} = img;
            if (width > maxPx || height > maxPx) {
                const r = Math.min(maxPx/width, maxPx/height);
                width = Math.round(width*r); height = Math.round(height*r);
            }
            const c = document.createElement('canvas');
            c.width = width; c.height = height;
            c.getContext('2d').drawImage(img, 0, 0, width, height);
            c.toBlob(blob => {
                if (!blob) { reject(new Error('Compression failed')); return; }
                resolve(new File([blob], 'upload.webp', {type:'image/webp'}));
            }, 'image/webp', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Invalid image')); };
        img.src = url;
    });
}
function doUpload(file, ticketId, onProgress, retryCount = 0) {
    return new Promise((resolve, reject) => {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('upload_preset', CLOUDINARY_PRESET);
        fd.append('tags', `bit_updates,ticket_${ticketId},uid_${currentUser.uid.slice(-8)}`);
        fd.append('folder', 'bit_updates/tickets');
        const xhr = new XMLHttpRequest();
        xhr.open('POST', CLOUDINARY_URL, true);
        xhr.upload.onprogress = e => {
            if (e.lengthComputable) onProgress(Math.round(e.loaded/e.total*100), 'uploading');
        };
        xhr.onload = () => {
            if (xhr.status === 200) {
                try {
                    const res = JSON.parse(xhr.responseText);
                    uploadLog.push(Date.now());
                    resolve({url: res.secure_url, publicId: res.public_id});
                } catch(e) { reject(new Error('Invalid response')); }
            } else {
                let msg = `Upload failed (HTTP ${xhr.status})`;
                try { msg = JSON.parse(xhr.responseText).error?.message || msg; } catch(_) {}
                if (xhr.status >= 500 && retryCount < MAX_RETRIES) {
                    const delay = RETRY_DELAYS[retryCount] || 15000;
                    onProgress(-1, 'retrying', retryCount+1, delay);
                    setTimeout(() => doUpload(file, ticketId, onProgress, retryCount+1).then(resolve).catch(reject), delay);
                } else reject(new Error(msg));
            }
        };
        xhr.onerror = () => {
            if (retryCount < MAX_RETRIES) {
                const delay = RETRY_DELAYS[retryCount] || 15000;
                onProgress(-1, 'retrying', retryCount+1, delay);
                setTimeout(() => doUpload(file, ticketId, onProgress, retryCount+1).then(resolve).catch(reject), delay);
            } else reject(new Error('Network error after retries.'));
        };
        xhr.timeout = 60_000;
        xhr.ontimeout = () => reject(new Error('Upload timed out.'));
        xhr.send(fd);
    });
}
function drainUploadQueue() {
    while (activeUploads < MAX_CONCURRENT && uploadQueue.length) {
        const job = uploadQueue.shift();
        activeUploads++;
        job.run().finally(() => { activeUploads--; drainUploadQueue(); });
    }
}
function enqueueUpload(file, ticketId, onProgress) {
    return new Promise((resolve, reject) => {
        uploadQueue.push({ run: () => doUpload(file, ticketId, onProgress).then(resolve).catch(reject) });
        drainUploadQueue();
    });
}

// Image picker UI
window.handleImagePick = function(input) {
    const file = input.files[0];
    if (!file) return;
    const err = validateImageFile(file);
    if (err) { showToast(err, 'error'); input.value = ''; return; }
    pendingImageFile = file;
    if (pendingImageURL) URL.revokeObjectURL(pendingImageURL);
    pendingImageURL = URL.createObjectURL(file);
    document.getElementById('img-thumb').src = pendingImageURL;
    document.getElementById('img-file-name').textContent = file.name.length > 26 ? file.name.slice(0,24)+'…' : file.name;
    document.getElementById('img-file-size').textContent = `${(file.size/1048576).toFixed(1)} MB`;
    document.getElementById('img-preview-wrap').classList.remove('hidden');
    document.getElementById('img-progress-wrap').classList.add('hidden');
};
window.clearImagePick = function() {
    pendingImageFile = null;
    if (pendingImageURL) { URL.revokeObjectURL(pendingImageURL); pendingImageURL = null; }
    document.getElementById('img-preview-wrap').classList.add('hidden');
    document.getElementById('img-progress-wrap').classList.add('hidden');
    document.getElementById('img-file-input').value = '';
};
function setUploadProgress(pct, state, retry, delay) {
    const wrap = document.getElementById('img-progress-wrap');
    const bar  = document.getElementById('img-progress-bar');
    const lbl  = document.getElementById('img-progress-label');
    wrap.classList.remove('hidden');
    if (state === 'retrying') {
        bar.style.width = '0%'; bar.className = 'h-full bg-amber-500 rounded-full transition-all duration-300';
        lbl.textContent = `Retrying (${retry}/${MAX_RETRIES}) in ${delay/1000}s…`;
    } else if (pct >= 0) {
        bar.style.width = pct+'%'; bar.className = 'h-full bg-indigo-500 rounded-full transition-all duration-300';
        lbl.textContent = pct < 100 ? `Uploading… ${pct}%` : 'Processing…';
    }
}

// ═══════════════════════════════════════════════════════════════════════
// TOAST & CONFIRM
// ═══════════════════════════════════════════════════════════════════════
window.showToast = function(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const colors = {success:'bg-slate-800 border-slate-700', error:'bg-rose-900/80 border-rose-500/50', info:'bg-indigo-900/80 border-indigo-500/50'};
    const icons  = {success:'fa-check-circle text-emerald-400', error:'fa-circle-exclamation text-rose-400', info:'fa-circle-info text-indigo-400'};
    toast.className = `flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border pointer-events-auto transform transition-all duration-300 translate-y-4 opacity-0 ${colors[type]||colors.success}`;
    toast.innerHTML = `<i class="fa-solid ${icons[type]||icons.success} shrink-0"></i><p class="text-sm font-medium text-slate-200 leading-tight">${escHTML(message)}</p>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.remove('translate-y-4','opacity-0'));
    setTimeout(() => { toast.classList.add('translate-y-4','opacity-0'); setTimeout(() => toast.remove(), 350); }, 4000);
};
window.showConfirm = function(title, msg, onConfirm) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent   = msg;
    const dialog = document.getElementById('confirm-dialog');
    dialog.classList.remove('hidden-safely');
    const cls = () => dialog.classList.add('hidden-safely');
    document.getElementById('confirm-ok').onclick  = () => { cls(); onConfirm(); };
    document.getElementById('confirm-cancel').onclick = cls;
};

// ═══════════════════════════════════════════════════════════════════════
// ASSIGN MODAL
// ═══════════════════════════════════════════════════════════════════════
window.closeAssignModal = function() {
    document.getElementById('assign-modal').classList.add('hidden-safely');
    document.getElementById('assign-modal-input').value = '';
    assignCallback = null;
};
function openAssignModal(label, cb) {
    document.getElementById('assign-modal-target').textContent = label;
    document.getElementById('assign-modal-input').value = '';
    document.getElementById('assign-modal').classList.remove('hidden-safely');
    assignCallback = cb;
    document.getElementById('assign-modal-input').focus();
}
document.getElementById('assign-modal-submit').onclick = function() {
    const val = document.getElementById('assign-modal-input').value.trim();
    if (assignCallback) assignCallback(val);
    closeAssignModal();
};

// ═══════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════
function saveNotifications() {
    localStorage.setItem('bitup_notifs', JSON.stringify(notifications.slice(0,50)));
}
function pushNotification(type, title, body, icon = 'fa-bell') {
    notifications.unshift({type, title, body, icon, ts: Date.now(), read: false});
    saveNotifications(); renderNotifPanel(); updateNotifBadge();
}
function renderNotifPanel() {
    const list = document.getElementById('notif-list');
    if (!list) return;
    if (!notifications.length) {
        list.innerHTML = '<p class="text-slate-500 text-xs text-center py-8">No notifications yet.</p>';
        return;
    }
    list.innerHTML = notifications.map((n, i) => `
        <div class="px-4 py-3 flex gap-3 items-start ${n.read?'opacity-50':'bg-indigo-950/20'} hover:bg-slate-800/40 transition cursor-pointer" onclick="window.markNotifRead(${i})">
            <div class="w-7 h-7 rounded-full bg-indigo-600/30 flex items-center justify-center shrink-0 mt-0.5">
                <i class="fa-solid ${n.icon} text-indigo-400 text-[10px]"></i>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-xs font-semibold text-white truncate">${escHTML(n.title)}</p>
                <p class="text-[11px] text-slate-400 mt-0.5">${escHTML(n.body)}</p>
                <p class="text-[10px] text-slate-600 mt-1">${timeAgo(n.ts)}</p>
            </div>
            ${!n.read ? '<span class="w-2 h-2 bg-indigo-500 rounded-full shrink-0 mt-2"></span>' : ''}
        </div>`).join('');
}
window.markNotifRead = function(i) {
    if (notifications[i]) { notifications[i].read = true; saveNotifications(); renderNotifPanel(); updateNotifBadge(); }
};
window.clearNotifications = function() {
    notifications = []; saveNotifications(); renderNotifPanel(); updateNotifBadge();
};
function updateNotifBadge() {
    const unread = notifications.filter(n => !n.read).length;
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    if (unread > 0) { badge.textContent = unread > 9 ? '9+' : unread; badge.classList.remove('hidden-safely'); }
    else badge.classList.add('hidden-safely');
}
window.toggleNotifPanel = function() {
    document.getElementById('notif-panel')?.classList.toggle('hidden-safely');
};
function checkNewTicketNotifs() {
    allTickets.forEach(t => {
        if (!_prevTicketIds.has(t.id) && !_firstTicketLoad) {
            if (isAdmin) pushNotification('ticket','New ticket submitted',`${t.authorName||'Student'}: ${t.title}`,'fa-ticket-simple');
            if (t.authorId === currentUser?.uid && t.comments) {
                Object.values(t.comments).filter(c=>c.isAdmin).forEach(c => {
                    const key = `nc_${t.id}_${c.createdAt}`;
                    if (!localStorage.getItem(key)) {
                        pushNotification('reply','Admin replied to your ticket',`"${t.title}"`,'fa-shield-check');
                        localStorage.setItem(key,'1');
                    }
                });
            }
        }
        _prevTicketIds.add(t.id);
    });
    if (_firstTicketLoad && allTickets.length > 0) _firstTicketLoad = false;
}

// ═══════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════
function setLoginBtnState(loading) {
    const gBtn = document.getElementById('btn-google-signin');
    const aBtn = document.getElementById('btn-anon-signin');
    gBtn.disabled = aBtn.disabled = loading;
    gBtn.innerHTML = loading
        ? '<i class="fa-solid fa-spinner fa-spin"></i> <span>Authenticating...</span>'
        : '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" class="w-5 h-5" alt="Google"> <span>Sign in with Google</span>';
}

// Google Sign-In — popup with redirect fallback
document.getElementById('btn-google-signin').onclick = async function() {
    setLoginBtnState(true);
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden-safely');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
        await signInWithPopup(auth, provider);
    } catch (e) {
        const fallbackCodes = ['auth/popup-blocked','auth/popup-closed-by-user','auth/cancelled-popup-request'];
        if (fallbackCodes.includes(e.code)) {
            try {
                await signInWithRedirect(auth, provider);
            } catch(e2) {
                errEl.textContent = e2.message || 'Sign-in failed.';
                errEl.classList.remove('hidden-safely');
                setLoginBtnState(false);
            }
        } else {
            errEl.textContent = e.message || 'Sign-in failed.';
            errEl.classList.remove('hidden-safely');
            setLoginBtnState(false);
        }
    }
};

document.getElementById('btn-anon-signin').onclick = async function() {
    setLoginBtnState(true);
    document.getElementById('login-error').classList.add('hidden-safely');
    try { await signInAnonymously(auth); }
    catch(e) {
        document.getElementById('login-error').textContent = 'Guest sign-in failed. ' + e.message;
        document.getElementById('login-error').classList.remove('hidden-safely');
        setLoginBtnState(false);
    }
};

document.getElementById('btn-logout-modal').onclick = () => signOut(auth);

// Handle redirect result on page load
getRedirectResult(auth).then(result => {
    if (result?.user) console.log('Redirect sign-in success');
}).catch(e => console.warn('Redirect result:', e.message));

// ── AUTH STATE ────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
        const email = (user.email || '').toLowerCase().trim();
        isAdmin = ADMIN_EMAILS.includes(email);

        document.getElementById('login-screen').classList.add('hidden-safely');
        document.getElementById('main-app').classList.remove('hidden-safely');
        document.getElementById('user-name').textContent = user.displayName || 'Student';

        if (isAdmin) {
            document.getElementById('admin-badge').classList.remove('hidden-safely');
            document.getElementById('admin-profile-badge').classList.remove('hidden-safely');
            document.getElementById('nav-admin-btn').classList.remove('hidden-safely');
            document.getElementById('admin-post-box').classList.remove('hidden-safely');
            showToast('Administrator access granted.', 'info');
            setTimeout(() => {
                if (currentView === 'tickets') renderTickets();
                else if (currentView === 'admin') renderAdminView();
            }, 400);
        } else {
            showToast(`Welcome, ${user.displayName || 'Student'}!`);
        }

        await loadUserData(user.uid);
        startListeners();
        switchView('about');
        updateNotifBadge();
        renderNotifPanel();
    } else {
        currentUser = null; isAdmin = false; userCache = {};
        allTickets = []; allUpdates = []; ticketsReady = false;
        _prevTicketIds.clear(); _firstTicketLoad = true;
        document.getElementById('login-screen').classList.remove('hidden-safely');
        document.getElementById('main-app').classList.add('hidden-safely');
        document.getElementById('profile-modal').classList.add('hidden-safely');
        document.getElementById('admin-badge').classList.add('hidden-safely');
        document.getElementById('admin-profile-badge').classList.add('hidden-safely');
        document.getElementById('nav-admin-btn').classList.add('hidden-safely');
        if (unsubTickets)  { unsubTickets();  unsubTickets  = null; }
        if (unsubAnnounce) { unsubAnnounce(); unsubAnnounce = null; }
        setLoginBtnState(false);
    }
});

// ── USER PROFILE ──────────────────────────────────────────────────────
async function loadUserData(uid) {
    try {
        const cached = localStorage.getItem('bitup_profile_' + uid);
        if (cached) {
            userCache = JSON.parse(cached);
            if (userCache.displayName) document.getElementById('user-name').textContent = userCache.displayName;
        }
    } catch(e) {}
    try {
        const snap = await getDoc(doc(db, USERS_COLLECTION, uid));
        if (snap.exists()) {
            userCache = { ...userCache, ...snap.data() };
            if (userCache.displayName) document.getElementById('user-name').textContent = userCache.displayName;
            localStorage.setItem('bitup_profile_' + uid, JSON.stringify(userCache));
        }
    } catch(e) { console.warn('Profile sync:', e); }
}

// Profile modal open
document.getElementById('btn-menu').onclick = () => {
    document.getElementById('prof-name').value   = userCache.displayName || currentUser?.displayName || '';
    document.getElementById('prof-prn').value    = userCache.prn || '';
    document.getElementById('prof-branch').value = userCache.branch || '';
    document.getElementById('prof-sem').value    = userCache.semester || '';
    document.getElementById('profile-modal').classList.remove('hidden-safely');
};
document.getElementById('btn-close-modal').onclick = () =>
    document.getElementById('profile-modal').classList.add('hidden-safely');

// Profile save
document.getElementById('btn-save-profile').onclick = async function() {
    if (!currentUser) return;
    const name = document.getElementById('prof-name').value.trim();
    if (!name) { showToast('Name cannot be empty.', 'error'); return; }
    const btn = this;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...';
    btn.disabled  = true;
    const data = {
        uid:         currentUser.uid,
        displayName: name,
        prn:         document.getElementById('prof-prn').value.trim(),
        branch:      document.getElementById('prof-branch').value.trim().toUpperCase(),
        semester:    document.getElementById('prof-sem').value,
        updatedAt:   serverTimestamp()
    };
    const localData = { ...data }; delete localData.updatedAt;
    userCache = { ...userCache, ...localData };
    localStorage.setItem('bitup_profile_' + currentUser.uid, JSON.stringify(userCache));
    document.getElementById('user-name').textContent = name;
    try {
        await setDoc(doc(db, USERS_COLLECTION, currentUser.uid), data, { merge: true });
        showToast('Profile saved!');
    } catch(e) {
        showToast('Saved locally. Firestore sync failed: ' + e.message, 'info');
    }
    document.getElementById('profile-modal').classList.add('hidden-safely');
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1"></i> Save Profile';
    btn.disabled  = false;
};

// ═══════════════════════════════════════════════════════════════════════
// REALTIME LISTENERS
// ═══════════════════════════════════════════════════════════════════════
function startListeners() {
    const tq = rtdbQuery(rtdbRef(rtdb, TICKETS_COLLECTION), rtdbOrderByChild('createdAtMs'), limitToLast(200));
    unsubTickets = onValue(tq, snap => {
        const rows = snap.val() || {};
        allTickets = Object.entries(rows)
            .map(([id, data]) => ({id, ...data}))
            .sort((a,b) => (b.createdAtMs||0) - (a.createdAtMs||0));
        ticketsReady = true;
        _saveTicketCache(allTickets);
        _cachedTicketHTML.clear(); // invalidate cache on any update
        if (currentView === 'tickets')   renderTickets();
        if (currentView === 'dashboard') renderDashboard();
        if (currentView === 'admin')     renderAdminView();
        updateTicketCount();
    }, err => {
        console.error('Tickets error:', err);
        const el = document.getElementById('loading-feed');
        el.innerHTML = `<div class="text-rose-400 text-center py-10 text-sm"><i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i><p>${escHTML(err.message)}</p></div>`;
        el.classList.remove('hidden-safely');
    });

    const aq = query(collection(db, ANNOUNCEMENTS_COLLECTION), orderBy('createdAt','desc'), limit(50));
    unsubAnnounce = onSnapshot(aq, snap => {
        allUpdates = snap.docs.map(d => ({id: d.id, ...d.data()}));
        if (currentView === 'updates') renderUpdatesView();
    });
}

// ═══════════════════════════════════════════════════════════════════════
// VIEW SWITCHING
// ═══════════════════════════════════════════════════════════════════════
document.querySelectorAll('.nav-tab-btn').forEach(btn =>
    btn.addEventListener('click', () => switchView(btn.dataset.view))
);
function switchView(view) {
    currentView = view;
    ['tickets','updates','dashboard','admin','resources','about'].forEach(v => {
        document.getElementById(`view-${v}`)?.classList.toggle('hidden-safely', v !== view);
    });
    document.querySelectorAll('.nav-tab-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.view === view)
    );
    if (view === 'tickets')   renderTickets();
    if (view === 'dashboard') renderDashboard();
    if (view === 'admin')     renderAdminView();
    if (view === 'updates')   renderUpdatesView();
    if (view === 'resources') renderResourcesView();
}

// ── STATUS FILTER ─────────────────────────────────────────────────────
document.querySelectorAll('.status-filter-btn').forEach(btn =>
    btn.addEventListener('click', () => {
        currentStatusFilter = btn.dataset.filter;
        document.querySelectorAll('.status-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (currentView !== 'tickets') switchView('tickets');
        else renderTickets();
    })
);
function updateTicketCount() {
    document.getElementById('ticket-count').textContent = filterTicketList().length;
}
function filterTicketList() {
    if (currentStatusFilter === 'open')   return allTickets.filter(t => (t.status||'open') === 'open');
    if (currentStatusFilter === 'closed') return allTickets.filter(t => t.status === 'closed');
    if (currentStatusFilter === 'mine')   return allTickets.filter(t => t.authorId === currentUser?.uid);
    return allTickets;
}

// ═══════════════════════════════════════════════════════════════════════
// RENDER TICKETS — chunked virtual list with HTML cache
// ═══════════════════════════════════════════════════════════════════════
function renderTickets() {
    const loadingEl = document.getElementById('loading-feed');
    const list      = document.getElementById('tickets-list');
    if (!ticketsReady) {
        loadingEl.classList.remove('hidden-safely');
        list.innerHTML = '';
        document.getElementById('ticket-count').textContent = '…';
        return;
    }
    loadingEl.classList.add('hidden-safely');
    const tickets = filterTicketList();
    document.getElementById('ticket-count').textContent = tickets.length;
    if (!tickets.length) {
        list.innerHTML = `<div class="text-center p-10 bg-slate-900/60 border border-slate-800 rounded-2xl">
            <i class="fa-solid fa-inbox text-3xl text-slate-600 mb-3"></i>
            <h3 class="text-white font-bold mb-1">No tickets found</h3>
            <p class="text-sm text-slate-500">Queue is empty for this filter.</p>
        </div>`;
        return;
    }
    _renderedCount = Math.min(VISIBLE_CHUNK, tickets.length);
    list.innerHTML = tickets.slice(0, _renderedCount).map(t => getCachedCard(t)).join('');
    const container = document.getElementById('view-tickets');
    container.onscroll = null;
    if (_renderedCount < tickets.length) {
        container.onscroll = function() {
            if (this.scrollTop + this.clientHeight >= this.scrollHeight - 300) {
                const next = tickets.slice(_renderedCount, _renderedCount + VISIBLE_CHUNK);
                if (next.length) {
                    list.insertAdjacentHTML('beforeend', next.map(t => getCachedCard(t)).join(''));
                    _renderedCount += next.length;
                }
                if (_renderedCount >= tickets.length) container.onscroll = null;
            }
        };
    }
    checkNewTicketNotifs();
}
function getCachedCard(t) {
    const key = t.id + '_' + (t.updatedAtMs || t.createdAtMs || 0) + '_' + (isAdmin ? 'a' : 'u');
    if (_cachedTicketHTML.has(key)) return _cachedTicketHTML.get(key);
    const html = buildTicketCard(t);
    _cachedTicketHTML.set(key, html);
    return html;
}

// ═══════════════════════════════════════════════════════════════════════
// BUILD TICKET CARD
// ═══════════════════════════════════════════════════════════════════════
function buildTicketCard(t) {
    const isMine = currentUser?.uid === t.authorId;
    const status = t.status || 'open';
    const avatar = t.authorPhoto
        ? `<img src="${escHTML(t.authorPhoto)}" class="w-10 h-10 rounded-xl object-cover border border-slate-700" alt="avatar">`
        : `<div class="w-10 h-10 rounded-xl bg-indigo-600/80 text-white flex items-center justify-center font-bold text-sm">${escHTML((t.authorName||'S')[0].toUpperCase())}</div>`;
    const byLine = escHTML(t.authorName||'Unknown') +
        (t.authorPRN ? ` <span class="font-mono text-[10px] bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded ml-1">${escHTML(t.authorPRN)}</span>` : '');
    const assignedBadge = t.assignedTo
        ? `<span class="text-[10px] bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded flex items-center gap-1"><i class="fa-solid fa-user-check text-indigo-400 text-[9px]"></i> ${escHTML(t.assignedTo)}</span>`
        : '';

    // Priority badge
    let priorityBadge = '';
    if (t.category === 'Exam') {
        priorityBadge = `<span class="text-[9px] font-extrabold bg-rose-600/30 border border-rose-500/50 text-rose-300 px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1"><i class="fa-solid fa-triangle-exclamation text-[8px]"></i> PRIORITY</span>`;
    } else if (t.category === 'Circular') {
        priorityBadge = `<span class="text-[9px] font-bold bg-blue-600/20 border border-blue-500/30 text-blue-300 px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1"><i class="fa-solid fa-bullhorn text-[8px]"></i> NOTICE</span>`;
    }

    // Comments
    let replyHTML = '';
    const commentsArr = t.comments ? Object.values(t.comments) : [];
    commentsArr.filter(c=>c.isAdmin).forEach(c => {
        replyHTML += `<div class="mt-4 bg-indigo-950/50 border border-indigo-800/50 p-4 rounded-xl relative">
            <div class="absolute left-0 top-0 w-1 h-full bg-indigo-500 rounded-l-xl"></div>
            <div class="flex items-center gap-2 mb-2 ml-3"><i class="fa-solid fa-shield-check text-indigo-400 text-xs"></i>
                <span class="text-[10px] font-extrabold text-indigo-300 uppercase tracking-widest">Admin Response</span>
            </div>
            <p class="text-sm text-slate-200 leading-relaxed ml-3 whitespace-pre-wrap">${escHTML(c.text)}</p>
        </div>`;
    });
    commentsArr.filter(c=>!c.isAdmin).forEach(c => {
        replyHTML += `<div class="mt-3 bg-slate-800/60 border border-slate-700 p-3 rounded-xl">
            <div class="text-[10px] font-semibold text-slate-400 mb-1 flex items-center gap-1">
                <i class="fa-regular fa-comment-dots"></i> ${escHTML(c.authorName||'User')}
            </div>
            <p class="text-xs text-slate-300 whitespace-pre-wrap">${escHTML(c.text)}</p>
        </div>`;
    });

    // Actions
    let adminActions = '', inputArea = '';
    if (isAdmin) {
        const newStatus = status === 'open' ? 'closed' : 'open';
        const toggleLabel = status === 'open' ? 'Mark Resolved' : 'Re-open';
        const toggleIcon  = status === 'open' ? 'fa-check' : 'fa-rotate-left';
        adminActions = `<div class="flex gap-2 flex-wrap">
            <button onclick="updateTicketStatus('${t.id}','${newStatus}')" class="text-[10px] bg-slate-900 border border-slate-700 hover:border-indigo-500 text-slate-400 hover:text-indigo-400 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 font-semibold">
                <i class="fa-solid ${toggleIcon}"></i> ${toggleLabel}
            </button>
            <button onclick="assignTicket('${t.id}')" class="text-[10px] bg-slate-900 border border-slate-700 hover:border-indigo-500 text-slate-400 hover:text-indigo-400 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 font-semibold">
                <i class="fa-solid fa-user-plus"></i> Assign
            </button>
            <button onclick="deleteTicket('${t.id}')" class="text-[10px] bg-slate-900 border border-rose-500/30 hover:bg-rose-500/20 text-rose-400 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>`;
        inputArea = `<div class="mt-4 pt-3 border-t border-slate-800 flex gap-2 items-center bg-slate-900/50 -mx-5 -mb-5 px-5 py-4 rounded-b-2xl">
            <div class="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-[10px] shrink-0"><i class="fa-solid fa-shield-halved"></i></div>
            <input type="text" id="reply-input-${t.id}" maxlength="600" placeholder="Write official response..." class="flex-1 bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 outline-none focus:border-indigo-500 transition">
            <button onclick="sendAdminReply('${t.id}')" class="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4 py-2 rounded-lg transition font-semibold shrink-0">
                <i class="fa-solid fa-paper-plane mr-1"></i>Send
            </button>
        </div>`;
    } else if (isMine) {
        adminActions = `<div class="flex gap-2">
            <button onclick="editTicket('${t.id}')" class="text-[10px] bg-slate-800 border border-slate-700 hover:border-amber-500/50 text-slate-400 hover:text-amber-400 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1">
                <i class="fa-solid fa-pen"></i> Edit
            </button>
            <button onclick="deleteTicket('${t.id}')" class="text-[10px] bg-slate-800 border border-slate-700 hover:border-rose-500/50 text-slate-400 hover:text-rose-400 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1">
                <i class="fa-solid fa-trash"></i> Remove
            </button>
        </div>`;
    }

    return `<div class="ticket-card bg-slate-900 p-5 rounded-2xl border border-slate-800 ${status==='closed'?'opacity-70':''}">
        <div class="flex gap-3 mb-3">
            ${avatar}
            <div class="flex-1 min-w-0">
                <div class="flex justify-between items-start gap-2">
                    <h3 class="font-bold text-white text-sm leading-snug">${escHTML(t.title)}</h3>
                    <div class="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                        <span class="text-[9px] font-bold ${statusColor(status)} border px-2 py-0.5 rounded-full uppercase tracking-wide">${escHTML(status)}</span>
                        ${priorityBadge}
                    </div>
                </div>
                <div class="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span class="text-[10px] font-semibold ${catColor(t.category)} border px-2 py-0.5 rounded-md flex items-center gap-1">
                        <i class="fa-solid ${catIcon(t.category)} text-[9px]"></i> ${escHTML(t.category||'General')}
                    </span>
                    ${t.year ? `<span class="text-[10px] bg-slate-800 border border-slate-700 text-slate-400 px-2 py-0.5 rounded-md flex items-center gap-1"><i class="fa-solid fa-graduation-cap text-indigo-400 text-[9px]"></i>${escHTML(t.year)}</span>` : ''}
                    ${t.branch ? `<span class="text-[10px] bg-slate-800 border border-slate-700 text-slate-400 px-2 py-0.5 rounded-md">${escHTML(t.branch)}</span>` : ''}
                    ${assignedBadge}
                    <span class="text-[10px] text-slate-600 border-l border-slate-800 pl-2 flex items-center gap-1"><i class="fa-regular fa-clock"></i>${timeAgo(t.createdAt)}</span>
                </div>
            </div>
        </div>
        <p class="text-sm text-slate-400 bg-slate-800/40 p-3.5 rounded-xl border border-slate-800 leading-relaxed whitespace-pre-wrap">${escHTML(t.description)}</p>
        ${t.imageURL ? `<div class="mt-3">
            <a href="${escHTML(t.imageURL)}" target="_blank" rel="noopener" class="block group relative rounded-xl overflow-hidden border border-slate-700 hover:border-indigo-500 transition">
                <img src="${escHTML(t.imageURL)}" alt="Attached image" loading="lazy" class="w-full max-h-64 object-cover transition group-hover:brightness-75" onerror="this.parentElement.parentElement.innerHTML='<p class=\\'text-xs text-slate-600 mt-2\\'>Image unavailable</p>'">
                <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                    <span class="bg-black/70 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5"><i class="fa-solid fa-up-right-from-square text-[10px]"></i> View full image</span>
                </div>
            </a>
        </div>` : ''}
        ${replyHTML}
        <div class="mt-3 flex justify-between items-center border-t border-slate-800 pt-3">
            <div class="text-[11px] text-slate-600 flex items-center gap-1">
                <i class="fa-solid fa-satellite-dish text-slate-700 text-[10px]"></i>
                Logged by <span class="font-semibold text-slate-400 ml-1">${byLine}</span>
                ${isMine ? '<span class="text-indigo-400 font-bold bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[9px] uppercase ml-2">You</span>' : ''}
            </div>
            ${adminActions}
        </div>
        ${inputArea}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// SUBMIT TICKET
// ═══════════════════════════════════════════════════════════════════════
window.submitTicket = async function() {
    if (!currentUser) { showToast('Please sign in first.', 'error'); return; }
    const category = document.getElementById('category-dropdown-btn').dataset.value;
    const year     = document.getElementById('ticket-year').value;
    const branch   = document.getElementById('ticket-branch').value;
    const title    = document.getElementById('ticket-title').value.trim();
    const desc     = document.getElementById('ticket-desc').value.trim();
    if (!category) { showToast('Please select a category.', 'error'); return; }
    if (!year)     { showToast('Please select a study year.', 'error'); return; }
    if (!branch)   { showToast('Please select a branch.', 'error'); return; }
    if (!title)    { showToast('Please enter a subject.', 'error'); return; }
    if (!desc)     { showToast('Please describe the issue.', 'error'); return; }

    const btn = document.getElementById('btn-submit-ticket');
    const isEditing = !!editTicketId;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Processing...';
    btn.disabled = true;
    const payload = {category, year, branch, title, description: desc};

    try {
        let imageURL = null, imagePath = null;
        if (pendingImageFile) {
            if (isRateLimited()) {
                showToast('Upload limit reached. Wait a minute.', 'error');
                btn.innerHTML = isEditing ? '<i class="fa-solid fa-pen mr-1"></i> Update Ticket' : '<i class="fa-solid fa-paper-plane mr-1"></i> Submit Ticket';
                btn.disabled = false;
                return;
            }
            const provId = isEditing ? editTicketId : `new_${Date.now()}_${currentUser.uid.slice(-6)}`;
            try {
                const compressed = await compressImage(pendingImageFile);
                const result = await enqueueUpload(compressed, provId, setUploadProgress);
                imageURL = result.url; imagePath = result.publicId;
            } catch(uploadErr) {
                showToast('Image upload failed: ' + (uploadErr.message||'Unknown error'), 'error');
                btn.innerHTML = isEditing ? '<i class="fa-solid fa-pen mr-1"></i> Update Ticket' : '<i class="fa-solid fa-paper-plane mr-1"></i> Submit Ticket';
                btn.disabled = false;
                document.getElementById('img-progress-wrap').classList.add('hidden');
                return;
            }
            if (imageURL) { payload.imageURL = imageURL; payload.imagePath = imagePath; }
        }

        if (isEditing) {
            const ticketRef = rtdbRef(rtdb, `${TICKETS_COLLECTION}/${editTicketId}`);
            const snap = await rtdbGet(ticketRef);
            const td   = snap.val();
            if (!snap.exists() || (td.authorId !== currentUser.uid && !isAdmin)) {
                showToast('Permission denied.', 'error'); return;
            }
            await rtdbUpdate(ticketRef, {...payload, updatedAtMs: Date.now()});
            showToast('Ticket updated.');
            editTicketId = null;
            document.getElementById('form-title').textContent = 'Raise a Ticket';
        } else {
            await push(rtdbRef(rtdb, TICKETS_COLLECTION), {
                ...payload,
                authorId:    currentUser.uid,
                authorName:  userCache.displayName || currentUser.displayName || 'Student',
                authorPRN:   userCache.prn || null,
                authorPhoto: currentUser.photoURL || null,
                status:      'open',
                createdAt:   Date.now(),
                createdAtMs: Date.now()
            });
            showToast('Ticket submitted!');
        }
        clearImagePick(); resetForm();
        currentStatusFilter = 'all';
        document.querySelectorAll('.status-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
        switchView('tickets');
    } catch(e) {
        console.error(e);
        showToast('Failed: ' + e.message, 'error');
    }
    btn.innerHTML = isEditing ? '<i class="fa-solid fa-pen mr-1"></i> Update Ticket' : '<i class="fa-solid fa-paper-plane mr-1"></i> Submit Ticket';
    btn.disabled = false;
};

function resetForm() {
    document.getElementById('ticket-year').value   = '';
    document.getElementById('ticket-branch').value = '';
    document.getElementById('ticket-title').value  = '';
    document.getElementById('ticket-desc').value   = '';
    document.getElementById('category-dropdown-btn').dataset.value = '';
    document.getElementById('selected-category-text').innerHTML = '<i class="fa-solid fa-tag text-slate-500 text-xs"></i> Select category...';
    document.querySelectorAll('#year-selector button, #branch-selector button').forEach(b => {
        b.classList.remove('bg-indigo-600','text-white','border-indigo-500');
        b.classList.add('bg-slate-800','text-slate-300','border-slate-700');
    });
    clearImagePick();
    editTicketId = null;
    document.getElementById('form-title').textContent = 'Raise a Ticket';
    document.getElementById('btn-submit-ticket').innerHTML = '<i class="fa-solid fa-paper-plane mr-1"></i> Submit Ticket';
}

// ═══════════════════════════════════════════════════════════════════════
// TICKET ACTIONS
// ═══════════════════════════════════════════════════════════════════════
window.sendAdminReply = async function(ticketId) {
    if (!isAdmin) { showToast('Access denied.', 'error'); return; }
    const input = document.getElementById(`reply-input-${ticketId}`);
    const text  = input?.value.trim();
    if (!text) { showToast('Response cannot be empty.', 'error'); return; }
    input.disabled = true;
    try {
        await push(rtdbRef(rtdb, `${TICKETS_COLLECTION}/${ticketId}/comments`), {
            text, authorId: auth.currentUser.uid,
            authorName: auth.currentUser.displayName || 'Admin',
            isAdmin: true, createdAt: Date.now()
        });
        await rtdbUpdate(rtdbRef(rtdb, `${TICKETS_COLLECTION}/${ticketId}`), {
            status: 'closed', repliedAtMs: Date.now(), updatedAtMs: Date.now()
        });
        showToast('Response posted and ticket resolved.');
        input.value = '';
    } catch(e) { showToast('Failed: ' + e.message, 'error'); }
    input.disabled = false;
};

window.updateTicketStatus = async function(ticketId, newStatus) {
    if (!isAdmin) { showToast('Access denied.', 'error'); return; }
    try {
        await rtdbUpdate(rtdbRef(rtdb, `${TICKETS_COLLECTION}/${ticketId}`), {status: newStatus, updatedAtMs: Date.now()});
        showToast(`Ticket marked as ${newStatus}.`);
    } catch(e) { showToast('Failed: ' + e.message, 'error'); }
};

window.assignTicket = function(ticketId) {
    if (!isAdmin) { showToast('Access denied.', 'error'); return; }
    openAssignModal('Assign ticket to:', async name => {
        try {
            await rtdbUpdate(rtdbRef(rtdb, `${TICKETS_COLLECTION}/${ticketId}`), {assignedTo: name||null, updatedAtMs: Date.now()});
            showToast(name ? `Assigned to ${name}.` : 'Assignment cleared.');
        } catch(e) { showToast('Failed: ' + e.message, 'error'); }
    });
};

window.deleteTicket = function(ticketId) {
    const ticket = allTickets.find(x => x.id === ticketId);
    if (!ticket) return;
    if (!isAdmin && ticket.authorId !== currentUser?.uid) { showToast('You can only delete your own tickets.', 'error'); return; }
    showConfirm('Delete Ticket', 'This will permanently remove this ticket.', async () => {
        try {
            await rtdbRemove(rtdbRef(rtdb, `${TICKETS_COLLECTION}/${ticketId}`));
            showToast('Ticket deleted.');
        } catch(e) { showToast('Delete failed: ' + e.message, 'error'); }
    });
};

window.editTicket = function(ticketId) {
    const t = allTickets.find(x => x.id === ticketId);
    if (!t) return;
    if (!isAdmin && t.authorId !== currentUser?.uid) { showToast('Permission denied.', 'error'); return; }
    editTicketId = ticketId;
    setCategory(t.category, t.category);
    document.getElementById('ticket-title').value = t.title || '';
    document.getElementById('ticket-desc').value  = t.description || '';
    document.querySelectorAll('#year-selector button').forEach(b => {
        const a = b.dataset.value === t.year;
        b.classList.toggle('bg-indigo-600',a); b.classList.toggle('text-white',a);
        b.classList.toggle('bg-slate-800',!a); b.classList.toggle('text-slate-300',!a);
        if (a) document.getElementById('ticket-year').value = t.year;
    });
    document.querySelectorAll('#branch-selector button').forEach(b => {
        const a = b.dataset.value === t.branch;
        b.classList.toggle('bg-indigo-600',a); b.classList.toggle('text-white',a);
        b.classList.toggle('bg-slate-800',!a); b.classList.toggle('text-slate-300',!a);
        if (a) document.getElementById('ticket-branch').value = t.branch;
    });
    document.getElementById('form-title').textContent = 'Edit Ticket';
    document.getElementById('btn-submit-ticket').innerHTML = '<i class="fa-solid fa-pen mr-1"></i> Update Ticket';
    window.scrollTo({top:0, behavior:'smooth'});
    switchView('tickets');
};

// ═══════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════
function renderDashboard() {
    const container = document.getElementById('dashboard-metrics');
    const open   = allTickets.filter(t=>(t.status||'open')==='open').length;
    const closed = allTickets.filter(t=>t.status==='closed').length;
    const catCounts = allTickets.reduce((a,t)=>{a[t.category]=(a[t.category]||0)+1;return a;},{});
    const topCat = Object.keys(catCounts).sort((a,b)=>catCounts[b]-catCounts[a])[0] || 'N/A';
    container.innerHTML = `
        <div class="glass-card p-5 rounded-2xl"><div class="text-xs text-indigo-300 font-bold uppercase tracking-widest mb-1 flex items-center gap-2"><i class="fa-solid fa-folder-open text-amber-400"></i> Open</div><div class="text-4xl font-bold text-white mt-2">${open}</div></div>
        <div class="glass-card p-5 rounded-2xl"><div class="text-xs text-indigo-300 font-bold uppercase tracking-widest mb-1 flex items-center gap-2"><i class="fa-solid fa-circle-check text-emerald-400"></i> Resolved</div><div class="text-4xl font-bold text-white mt-2">${closed}</div></div>
        <div class="glass-card p-5 rounded-2xl"><div class="text-xs text-indigo-300 font-bold uppercase tracking-widest mb-1 flex items-center gap-2"><i class="fa-solid fa-chart-bar text-purple-400"></i> Top Category</div><div class="text-xl font-bold text-white mt-2 truncate">${escHTML(topCat)}</div></div>
        <div class="glass-card p-5 rounded-2xl"><div class="text-xs text-indigo-300 font-bold uppercase tracking-widest mb-1 flex items-center gap-2"><i class="fa-solid fa-ticket text-indigo-400"></i> Total</div><div class="text-4xl font-bold text-white mt-2">${allTickets.length}</div></div>
        <div class="glass-card p-5 rounded-2xl col-span-full mt-2"><div class="text-xs text-indigo-300 font-bold uppercase tracking-widest mb-4">Ticket Distribution by Category</div><div id="neon-graph" class="w-full" style="height:220px;"></div></div>`;
    requestAnimationFrame(() => setTimeout(() => renderD3Graph(catCounts), 50));
}
function renderD3Graph(data) {
    const container = document.getElementById('neon-graph');
    if (!container) return;
    container.innerHTML = '';
    const W = container.clientWidth || 500, H = 200;
    const keys = Object.keys(data), vals = Object.values(data);
    if (!keys.length) { container.innerHTML = '<p class="text-slate-500 text-sm text-center pt-10">No data yet.</p>'; return; }
    const svg = d3.select('#neon-graph').append('svg').attr('width',W).attr('height',H).attr('viewBox',`0 0 ${W} ${H}`);
    const defs = svg.append('defs');
    const filt = defs.append('filter').attr('id','glow2');
    filt.append('feGaussianBlur').attr('stdDeviation','3').attr('result','blur');
    const mrg = filt.append('feMerge'); mrg.append('feMergeNode').attr('in','blur'); mrg.append('feMergeNode').attr('in','SourceGraphic');
    const m = {top:20,right:20,bottom:40,left:30};
    const x = d3.scaleBand().domain(keys).range([m.left,W-m.right]).padding(0.4);
    const y = d3.scaleLinear().domain([0,d3.max(vals)||1]).range([H-m.bottom,m.top]);
    svg.append('g').attr('transform',`translate(0,${H-m.bottom})`).call(d3.axisBottom(x)).selectAll('text').attr('fill','#64748b').attr('font-size','10px').attr('font-family','DM Sans');
    svg.selectAll('.domain,.tick line').attr('stroke','#1e293b');
    const g = defs.append('linearGradient').attr('id','bg2').attr('x1','0').attr('x2','0').attr('y1','0').attr('y2','1');
    g.append('stop').attr('offset','0%').attr('stop-color','#818cf8');
    g.append('stop').attr('offset','100%').attr('stop-color','#4f46e5');
    svg.selectAll('rect').data(keys).enter().append('rect').attr('x',d=>x(d)).attr('y',d=>y(data[d])).attr('width',x.bandwidth()).attr('height',d=>H-m.bottom-y(data[d])).attr('fill','url(#bg2)').attr('filter','url(#glow2)').attr('rx',4);
    svg.selectAll('.lbl').data(keys).enter().append('text').attr('x',d=>x(d)+x.bandwidth()/2).attr('y',d=>y(data[d])-5).attr('text-anchor','middle').attr('fill','#a5b4fc').attr('font-size','11px').attr('font-family','DM Sans').text(d=>data[d]);
}

// ═══════════════════════════════════════════════════════════════════════
// ADMIN VIEW
// ═══════════════════════════════════════════════════════════════════════
function renderAdminView() {
    if (!isAdmin) return;
    const container = document.getElementById('admin-controls');
    const users = [...new Set(allTickets.map(t=>t.authorId||'anon'))];
    container.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div class="glass-card p-5 rounded-2xl">
            <h3 class="text-white font-bold mb-4 flex items-center gap-2 text-sm"><i class="fa-solid fa-ticket text-indigo-400"></i> All Tickets (${allTickets.length})</h3>
            <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
                ${allTickets.map(t=>`<div class="flex justify-between items-center p-3 bg-slate-950 rounded-lg border border-slate-800 gap-3">
                    <div class="min-w-0"><p class="text-sm text-slate-300 truncate font-medium">${escHTML(t.title)}</p>
                    <p class="text-[10px] text-slate-500 mt-0.5">${escHTML(t.authorName||'')} · <span class="${t.status==='closed'?'text-emerald-400':'text-amber-400'}">${t.status||'open'}</span></p></div>
                    <button onclick="deleteTicket('${t.id}')" class="text-rose-400 hover:text-rose-300 p-1.5 shrink-0 transition"><i class="fa-solid fa-trash text-xs"></i></button>
                </div>`).join('')}
            </div>
        </div>
        <div class="glass-card p-5 rounded-2xl">
            <h3 class="text-white font-bold mb-4 flex items-center gap-2 text-sm"><i class="fa-solid fa-users text-indigo-400"></i> Participation</h3>
            <div class="space-y-3">
                <div class="flex justify-between text-sm"><span class="text-slate-400">Unique users</span><span class="font-bold text-white">${users.length}</span></div>
                <div class="flex justify-between text-sm"><span class="text-slate-400">Total tickets</span><span class="font-bold text-white">${allTickets.length}</span></div>
                <div class="flex justify-between text-sm"><span class="text-slate-400">Open</span><span class="font-bold text-amber-400">${allTickets.filter(t=>(t.status||'open')==='open').length}</span></div>
                <div class="flex justify-between text-sm"><span class="text-slate-400">Resolved</span><span class="font-bold text-emerald-400">${allTickets.filter(t=>t.status==='closed').length}</span></div>
            </div>
            <div class="mt-4 p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs text-slate-500 flex items-center gap-2">
                <i class="fa-solid fa-shield-halved text-indigo-400"></i> Admin: co.2024.prdeshkar@bitwardha.ac.in
            </div>
        </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// ANNOUNCEMENTS — rich media system
// ═══════════════════════════════════════════════════════════════════════
window.setAnnouncTab = function(tab) {
    currentAnnTab = tab;
    ['text','image','poll','video','file'].forEach(t => {
        document.getElementById('ann-panel-'+t)?.classList.toggle('hidden-safely', t !== tab);
        const btn = document.getElementById('atab-'+t);
        if (!btn) return;
        const active = t === tab;
        btn.classList.toggle('border-indigo-500', active);
        btn.classList.toggle('text-indigo-300', active);
        btn.classList.toggle('border-transparent', !active);
        btn.classList.toggle('text-slate-500', !active);
    });
};
window.previewAnnImg = function(input) {
    const file = input.files[0]; if (!file) return;
    annImgFile = file;
    if (annImgURL) URL.revokeObjectURL(annImgURL);
    annImgURL = URL.createObjectURL(file);
    document.getElementById('ann-img-thumb').src = annImgURL;
    document.getElementById('ann-img-preview').classList.remove('hidden-safely');
};
window.clearAnnImg = function() {
    annImgFile = null;
    if (annImgURL) { URL.revokeObjectURL(annImgURL); annImgURL = null; }
    document.getElementById('ann-img-thumb').src = '';
    document.getElementById('ann-img-preview').classList.add('hidden-safely');
    document.getElementById('ann-img-input').value = '';
};
window.addPollOption = function() {
    const wrap = document.getElementById('poll-options-wrap');
    const count = wrap.querySelectorAll('.poll-opt-input').length + 1;
    if (count > 6) { showToast('Maximum 6 options.', 'info'); return; }
    const inp = document.createElement('input');
    inp.type='text'; inp.maxLength=80; inp.placeholder=`Option ${count}`;
    inp.className='poll-opt-input w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm p-2.5 rounded-lg';
    wrap.appendChild(inp);
};
window.postAnnouncement = async function() {
    if (!isAdmin) { showToast('Admin only.', 'error'); return; }
    const targetYear   = document.getElementById('ann-target-year')?.value || '';
    const targetBranch = document.getElementById('ann-target-branch')?.value || '';
    const base = { authorName: userCache.displayName||'Admin', createdAt: serverTimestamp(),
                   targetYear: targetYear||null, targetBranch: targetBranch||null, type: currentAnnTab };
    try {
        if (currentAnnTab === 'text') {
            const text = document.getElementById('announcement-text').value.trim();
            if (!text) { showToast('Cannot post empty announcement.', 'error'); return; }
            await addDoc(collection(db, ANNOUNCEMENTS_COLLECTION), {...base, text});
            document.getElementById('announcement-text').value = '';
        } else if (currentAnnTab === 'image') {
            const caption = document.getElementById('ann-img-caption').value.trim();
            let imgURL = null;
            if (annImgFile) {
                try { const c = await compressImage(annImgFile); const r = await enqueueUpload(c, 'ann_'+Date.now(), ()=>{}); imgURL = r.url; }
                catch(e) { showToast('Image upload failed: '+e.message,'error'); return; }
            }
            if (!imgURL && !caption) { showToast('Add an image or caption.','error'); return; }
            await addDoc(collection(db, ANNOUNCEMENTS_COLLECTION), {...base, caption, imageURL: imgURL});
            clearAnnImg(); document.getElementById('ann-img-caption').value='';
        } else if (currentAnnTab === 'poll') {
            const question = document.getElementById('poll-question').value.trim();
            const options  = [...document.querySelectorAll('.poll-opt-input')].map(i=>i.value.trim()).filter(Boolean);
            if (!question) { showToast('Enter a poll question.','error'); return; }
            if (options.length < 2) { showToast('Add at least 2 options.','error'); return; }
            await addDoc(collection(db, ANNOUNCEMENTS_COLLECTION), {...base, question, options, votes:{}});
            document.getElementById('poll-question').value='';
            document.querySelectorAll('.poll-opt-input').forEach(i=>i.value='');
        } else if (currentAnnTab === 'video') {
            const url = document.getElementById('ann-video-url').value.trim();
            if (!url) { showToast('Enter a video link.','error'); return; }
            const caption = document.getElementById('ann-video-caption').value.trim();
            await addDoc(collection(db, ANNOUNCEMENTS_COLLECTION), {...base, videoURL: url, caption});
            document.getElementById('ann-video-url').value=''; document.getElementById('ann-video-caption').value='';
        } else if (currentAnnTab === 'file') {
            const url = document.getElementById('ann-file-url').value.trim();
            const fname = document.getElementById('ann-file-name').value.trim();
            if (!url)   { showToast('Enter a file link.','error'); return; }
            if (!fname) { showToast('Enter a display name.','error'); return; }
            const caption = document.getElementById('ann-file-caption').value.trim();
            await addDoc(collection(db, ANNOUNCEMENTS_COLLECTION), {...base, fileURL:url, fileName:fname, caption});
            document.getElementById('ann-file-url').value=''; document.getElementById('ann-file-name').value=''; document.getElementById('ann-file-caption').value='';
        }
        showToast('Announcement posted!');
        pushNotification('announcement','New announcement posted','By '+(userCache.displayName||'Admin'),'fa-bullhorn');
    } catch(e) { showToast('Failed: '+e.message,'error'); }
};

// ── UPDATES VIEW ──────────────────────────────────────────────────────
function renderUpdatesView() {
    const feed = document.getElementById('updates-feed');
    if (!allUpdates.length) { feed.innerHTML='<p class="text-slate-500 text-center py-10 text-sm">No public updates yet.</p>'; return; }
    feed.innerHTML = allUpdates.map(u => buildUpdateCard(u)).join('');
}
function buildUpdateCard(u) {
    const type = u.type || 'text';
    const targetTag = (u.targetYear||u.targetBranch)
        ? `<span class="text-[9px] bg-indigo-950/60 border border-indigo-800/40 text-indigo-400 px-2 py-0.5 rounded-full">${[u.targetYear,u.targetBranch].filter(Boolean).join(' · ')}</span>`
        : '';
    let body = '';
    if (type === 'text') {
        body = `<p class="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">${escHTML(u.text||'')}</p>`;
    } else if (type === 'image') {
        body = (u.imageURL ? `<a href="${escHTML(u.imageURL)}" target="_blank" class="block group relative rounded-xl overflow-hidden border border-slate-700 hover:border-indigo-500 transition mb-2"><img src="${escHTML(u.imageURL)}" class="w-full max-h-64 object-cover group-hover:brightness-75 transition" loading="lazy"></a>` : '')
             + (u.caption ? `<p class="text-slate-300 text-sm">${escHTML(u.caption)}</p>` : '');
    } else if (type === 'poll') {
        const votes = u.votes || {};
        const total = Object.values(votes).reduce((a,b)=>a+(Array.isArray(b)?b.length:0),0);
        body = `<p class="text-white font-semibold text-sm mb-3">${escHTML(u.question||'')}</p>`
             + (u.options||[]).map((opt,i)=>{
                 const count = Array.isArray(votes[i]) ? votes[i].length : 0;
                 const pct   = total>0 ? Math.round(count/total*100) : 0;
                 const voted = Array.isArray(votes[i]) && currentUser && votes[i].includes(currentUser.uid);
                 return `<button onclick="window.votePoll('${u.id}',${i})" class="w-full text-left rounded-xl border ${voted?'border-indigo-500 bg-indigo-950/50':'border-slate-700 bg-slate-800/60'} p-3 transition hover:border-indigo-500 mb-2">
                     <div class="flex justify-between text-sm mb-1.5"><span class="${voted?'text-indigo-300 font-semibold':'text-slate-300'}">${escHTML(opt)}</span><span class="text-xs text-slate-500 font-mono">${pct}%</span></div>
                     <div class="w-full bg-slate-700 rounded-full h-1.5"><div class="h-1.5 rounded-full ${voted?'bg-indigo-500':'bg-slate-500'} transition-all" style="width:${pct}%"></div></div>
                 </button>`;
             }).join('') + `<p class="text-[10px] text-slate-600 mt-1">${total} vote${total!==1?'s':''}</p>`;
    } else if (type === 'video') {
        const ytMatch = (u.videoURL||'').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([A-Za-z0-9_-]{11})/);
        body = (ytMatch ? `<div class="relative w-full rounded-xl overflow-hidden border border-slate-700 mb-2" style="padding-top:56.25%"><iframe class="absolute inset-0 w-full h-full" src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allowfullscreen loading="lazy"></iframe></div>`
               : `<a href="${escHTML(u.videoURL||'')}" target="_blank" class="flex items-center gap-2 text-sm text-indigo-400 mb-2"><i class="fa-brands fa-youtube"></i> Watch Video</a>`)
             + (u.caption ? `<p class="text-slate-300 text-sm">${escHTML(u.caption)}</p>` : '');
    } else if (type === 'file') {
        body = `<a href="${escHTML(u.fileURL||'')}" target="_blank" rel="noopener" class="flex items-center gap-3 bg-slate-800/80 border border-slate-700 hover:border-indigo-500 rounded-xl p-3.5 transition group mb-2">
            <div class="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-600/30 flex items-center justify-center shrink-0"><i class="fa-solid fa-file text-indigo-400"></i></div>
            <div class="flex-1 min-w-0"><p class="text-sm font-semibold text-white truncate group-hover:text-indigo-300 transition">${escHTML(u.fileName||'Download')}</p><p class="text-[10px] text-slate-500">Click to open</p></div>
            <i class="fa-solid fa-arrow-up-right-from-square text-slate-600 group-hover:text-indigo-400 transition text-xs"></i>
        </a>` + (u.caption ? `<p class="text-slate-300 text-sm">${escHTML(u.caption)}</p>` : '');
    }
    const typeIcons = {text:'fa-font',image:'fa-image',poll:'fa-chart-bar',video:'fa-play',file:'fa-file'};
    return `<div class="glass-card p-4 rounded-2xl border border-slate-800 mb-4">
        <div class="flex items-center gap-2 mb-3">
            <span class="text-[9px] font-bold bg-slate-800 border border-slate-700 text-slate-400 px-2 py-0.5 rounded-full uppercase flex items-center gap-1"><i class="fa-solid ${typeIcons[type]||'fa-font'} text-[8px]"></i> ${type}</span>
            ${targetTag}
        </div>
        ${body}
        <div class="flex justify-between items-center mt-3 pt-2 border-t border-slate-800">
            <span class="text-[10px] text-slate-500 flex items-center gap-1"><i class="fa-solid fa-user-shield text-indigo-400"></i> ${escHTML(u.authorName||'Admin')} · ${timeAgo(u.createdAt)}</span>
            ${isAdmin ? `<button onclick="window.deleteAnnouncement('${u.id}')" class="text-[10px] text-rose-400 hover:text-rose-300 transition"><i class="fa-solid fa-trash mr-1"></i>Delete</button>` : ''}
        </div>
    </div>`;
}
window.votePoll = async function(announcementId, optionIndex) {
    if (!currentUser || currentUser.isAnonymous) { showToast('Sign in with Google to vote.','info'); return; }
    try {
        await updateDoc(doc(db, ANNOUNCEMENTS_COLLECTION, announcementId), {[`votes.${optionIndex}`]: arrayUnion(currentUser.uid)});
        showToast('Vote recorded!');
    } catch(e) { showToast('Failed: '+e.message,'error'); }
};
window.deleteAnnouncement = function(id) {
    if (!isAdmin) return;
    showConfirm('Delete Announcement','Remove this for all students?', async () => {
        try {
            const {deleteDoc} = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
            await deleteDoc(doc(db, ANNOUNCEMENTS_COLLECTION, id));
            showToast('Deleted.');
        } catch(e) { showToast('Failed: '+e.message,'error'); }
    });
};

// ═══════════════════════════════════════════════════════════════════════
// RESOURCES
// ═══════════════════════════════════════════════════════════════════════
const RESOURCES = {
    "First Year (FY)": [
        {title:"FY PYQ (All Subjects) - Set 1",author:"Previous Year Questions",link:"https://drive.google.com/drive/folders/14-MjWjZStCQhwGOWpprH8Sc44GrlX_cE"},
        {title:"FY PYQ (All Subjects) - Set 2",author:"Previous Year Questions",link:"https://drive.google.com/drive/folders/1bpFzsgC0Ri0zVgg6yEVJ6JqC9BazlMiP"}
    ],
    "Second Year (SY)": [{title:"BTech SY PYQ (All Subjects)",author:"Previous Year Questions",link:"https://drive.google.com/drive/folders/1MRgDb89eTYvRHOIh1RQrClZORIJ1134l"}],
    "Third Year (TY)":  [{title:"BTech TY PYQ (All Subjects)",author:"Previous Year Questions",link:"https://drive.google.com/drive/folders/1Nhn4DwiE8ztVt_-QoOrkTDrSUq4b_DA-"}],
    "Final Year":       [{title:"BTech Final Year PYQ (All Subjects)",author:"Previous Year Questions",link:"https://drive.google.com/drive/folders/1EPQ-g1d0dlmryhTNMplAmDHRYemoGH6E"}]
};
window.renderResourcesView = function(branch = "First Year (FY)") {
    const feed = document.getElementById('resources-feed');
    const tabs = Object.keys(RESOURCES).map(b =>
        `<button onclick="window.renderResourcesView('${b}')" class="px-4 py-2 rounded-xl text-sm font-medium transition ${b===branch?'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20':'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'}">${b}</button>`
    ).join('');
    const items = (RESOURCES[branch]||[]).map(r =>
        `<div class="glass-card p-4 rounded-xl border border-slate-700 flex justify-between items-center gap-4">
            <div><h4 class="text-white font-semibold text-sm">${escHTML(r.title)}</h4><p class="text-xs text-slate-400 mt-0.5">by ${escHTML(r.author)}</p></div>
            <a href="${r.link}" target="_blank" rel="noopener" class="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition shrink-0 flex items-center gap-1"><i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i> Open</a>
        </div>`
    ).join('') || '<p class="text-slate-500 text-sm text-center py-4">Select your year</p>';
    feed.innerHTML = `<div class="flex flex-wrap gap-2 mb-5">${tabs}</div><div class="space-y-3">${items}</div>`;
};

// ═══════════════════════════════════════════════════════════════════════
// DROPDOWN / PILL HELPERS
// ═══════════════════════════════════════════════════════════════════════
window.toggleDropdown = function() {
    document.getElementById('category-options').classList.toggle('hidden');
};
window.setCategory = function(value, label) {
    document.getElementById('category-dropdown-btn').dataset.value = value;
    document.getElementById('selected-category-text').innerHTML = `<i class="fa-solid fa-tag text-indigo-400 text-xs"></i> ${escHTML(label)}`;
    document.getElementById('category-options').classList.add('hidden');
};
window.selectPill = function(hiddenId, btn) {
    document.getElementById(hiddenId).value = btn.dataset.value;
    btn.parentElement.querySelectorAll('button').forEach(b => {
        b.classList.remove('bg-indigo-600','text-white','border-indigo-500');
        b.classList.add('bg-slate-800','text-slate-300','border-slate-700');
    });
    btn.classList.add('bg-indigo-600','text-white','border-indigo-500');
    btn.classList.remove('bg-slate-800','text-slate-300');
};

// ── GLOBAL CLICK HANDLER ──────────────────────────────────────────────
document.addEventListener('click', e => {
    if (!e.target.closest('#ticket-category-wrapper'))
        document.getElementById('category-options')?.classList.add('hidden');
    if (!e.target.closest('#btn-bell') && !e.target.closest('#notif-panel'))
        document.getElementById('notif-panel')?.classList.add('hidden-safely');
});

// Init
updateNotifBadge();
renderNotifPanel();
</script>
