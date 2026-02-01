// ======================================================
// 1. SETUP & CONFIGURATION
// ======================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// --- 🔴 PASTE KEYS HERE 🔴 ---
const SUPABASE_URL = 'https://zgrlpfxkobhomwfifbst.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpncmxwZnhrb2Job213ZmlmYnN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxODIxNDgsImV4cCI6MjA3OTc1ODE0OH0.Bro0RZqhQLgxlJbfwQfv4XWvI4DTa_9zrWeZVRKv8Ww';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Constants
const ROOM_ID = "KANPUR25";
const ADMIN_PASS = "9936";

// Auth State
let myUid = localStorage.getItem('meetup_uid');
if (!myUid) {
    myUid = 'uid_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('meetup_uid', myUid);
}
let myName = localStorage.getItem('meetup_name') || "User";
let myRole = "student";

// UI Helpers
const $ = (id) => document.getElementById(id);
if($('device-id-display')) $('device-id-display').innerText = `ID: ${myUid.substring(0,6)}`;
let timerInterval = null;
let lastActiveQ = "";

// --- GLOBAL HELPERS (Defined immediately for HTML buttons) ---
window.kickUser = async (uid) => { 
    console.log("Kicking:", uid);
    if(confirm("Kick this user?")) await supabase.from('users').update({ is_kicked: true }).eq('uid', uid); 
};

window.buzzUser = async (uid) => { 
    console.log("Buzzing:", uid);
    await supabase.from('users').update({ is_vibrate: true }).eq('uid', uid); 
};

window.broadcastConfession = async (text) => {
    if(confirm("Broadcast?")) {
        await supabase.from('rooms').update({ 
            mode: 'CONFESS',       // Force screen change
            broadcast_msg: text 
        }).eq('id', ROOM_ID);
    }
};

// ======================================================
// 2. INITIALIZATION & LISTENERS
// ======================================================

document.addEventListener("DOMContentLoaded", () => {
    console.log("✅ App Ready");
    attachListeners();
    checkInit();
});

function attachListeners() {
    // Login
    if($('btn-login')) $('btn-login').onclick = handleLogin;

    // Admin Nav
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if(btn.dataset.mode) btn.onclick = () => setMode(btn.dataset.mode);
    });

    // Admin Controls
    if($('btn-reset-room')) $('btn-reset-room').onclick = resetRoom;
    if($('btn-spin')) $('btn-spin').onclick = spinWheel;
    if($('btn-force-reveal')) $('btn-force-reveal').onclick = forceReveal;
    if($('btn-tribunal-toggle')) $('btn-tribunal-toggle').onclick = toggleTribunal;
    if($('btn-best-3')) $('btn-best-3').onclick = () => startTourney(3);
    if($('btn-best-5')) $('btn-best-5').onclick = () => startTourney(5);
    if($('btn-next-q')) $('btn-next-q').onclick = nextQuestion;
    if($('btn-calc-winner')) $('btn-calc-winner').onclick = calcRoundWinner;
    if($('btn-set-theme')) $('btn-set-theme').onclick = setTheme;
    if($('btn-clear-broadcast')) $('btn-clear-broadcast').onclick = clearBroadcast;
    if($('json-upload')) $('json-upload').onchange = handleFileUpload;

    // Student Controls
    if($('btn-choice-truth')) $('btn-choice-truth').onclick = () => makeChoice('Truth');
    if($('btn-choice-dare')) $('btn-choice-dare').onclick = () => makeChoice('Dare');
    if($('btn-confess-submit')) $('btn-confess-submit').onclick = submitConfess;
    if($('btn-guess-submit')) $('btn-guess-submit').onclick = submitGuess;
    if($('btn-vote-pass')) $('btn-vote-pass').onclick = () => castVote('pass');
    if($('btn-vote-fail')) $('btn-vote-fail').onclick = () => castVote('fail');
}


// ======================================================
// 3. CORE LOGIC
// ======================================================

async function handleLogin() {
    const name = $('inp-name').value.trim();
    const code = $('inp-code').value.trim();
    const btn = $('btn-login');

    if (!name || !code) return alert("Fill all fields");
    btn.innerText = "..."; btn.disabled = true;

    if (code === ADMIN_PASS) {
        myRole = "admin";
        switchScreen('screen-admin');
        startAdminListeners();
        return;
    }

    if (code !== ROOM_ID) {
        alert("Wrong Code");
        btn.innerText = "JOIN"; btn.disabled = false;
        return;
    }

    myRole = "student";
    myName = name;
    
    await supabase.from('users').upsert({ uid: myUid, name: name, last_seen: new Date(), is_kicked: false });
    switchScreen('screen-student');
    startStudentListener();
    
    // Heartbeat (60s)
    setInterval(async () => {
        await supabase.from('users').update({ last_seen: new Date() }).eq('uid', myUid);
    }, 60000);
}


// ======================================================
// 4. STUDENT LOGIC
// ======================================================

function startStudentListener() {
    // Room Updates
    supabase.channel('public:rooms').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${ROOM_ID}` }, 
    (payload) => renderStudentUI(payload.new)).subscribe();

    // My User Updates
    supabase.channel(`public:users:${myUid}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users', filter: `uid=eq.${myUid}` }, 
    (payload) => {
        const u = payload.new;
        if (u.is_kicked) location.reload();
        if (u.is_vibrate && navigator.vibrate) {
            navigator.vibrate([500, 200, 500]);
            supabase.from('users').update({ is_vibrate: false }).eq('uid', myUid);
        }
    }).subscribe();

    supabase.from('rooms').select('*').eq('id', ROOM_ID).single().then(({data}) => { if(data) renderStudentUI(data); });
}

function renderStudentUI(data) {
    const gs = data.game_state || {};
    const title = $('stu-title');
    const content = $('stu-content');
    
    $('stu-rng-choice').classList.add('hidden');
    $('stu-confess-input').classList.add('hidden');
    $('stu-guess-input').classList.add('hidden');
    $('stu-tribunal').classList.add('hidden');

    // LOBBY
    if (data.mode === 'LOBBY') {
        title.innerText = "Chill Zone 🧊";
        content.innerText = "Waiting for Ujjwal...";
    }
    // RNG
// RNG Section
    else if (data.mode === 'RNG') {
        // 1. Handle Tribunal Visibility
        if (data.tribunal_active) {
            $('stu-tribunal').classList.remove('hidden');
        } else {
            $('stu-tribunal').classList.add('hidden');
        }

        // 2. Handle Game State (Using direct columns now)
        if (data.rng_state === 'SPINNING') {
            title.innerText = "Spinning..."; 
            content.innerText = "🎰";
        } 
        else if (data.rng_state === 'CHOOSING') {
            title.innerText = "VICTIM SELECTED";
            
            // Check if I am the victim
            // data.current_victim is a JSON object {uid: "...", name: "..."}
            if (data.current_victim && data.current_victim.uid === myUid) {
                content.innerHTML = `<h1 style="color:var(--red)">IT'S YOU! 🫵</h1>`;
                $('stu-rng-choice').classList.remove('hidden'); // Show T/D Buttons
            } else {
                content.innerHTML = `<h1 style="color:var(--red)">${data.current_victim?.name || '...'}</h1><p>is choosing...</p>`;
            }
        } 
        else if (data.rng_state === 'REVEALED') {
            title.innerText = data.task_type;
            content.innerHTML = `<h1>${data.current_victim?.name}</h1><p class="timer">${data.task_content}</p>`;
        }
    }
    
    // CONFESS
    else if (data.mode === 'CONFESS') {
        if (data.broadcast_msg) {
            title.innerText = "📢 SOMEONE SAID...";
            content.innerHTML = `<div class="result-box">${data.broadcast_msg}</div>`;
        } else {
            title.innerText = "Spill Tea ☕";
            content.innerText = "Anonymous Mode On.";
            $('confess-topic').innerText = "Topic: " + (data.confess_theme || "Anything");
            $('stu-confess-input').classList.remove('hidden');
        }
    }
    // GUESS (Upgraded UI)
    else if (data.mode === 'GUESS') {
        if (data.guess_state === 'GRAND_WINNER') {
            title.innerText = "👑 GRAND CHAMPION 👑";
            
            // Build detailed list
            let historyHTML = '<div style="text-align:left; font-size:0.9rem; margin-top:20px; border-top:1px dashed #000; padding-top:10px;">';
            (data.round_winners || []).forEach((w, i) => {
                historyHTML += `<div><b>Round ${i+1}:</b> ${w}</div>`;
            });
            historyHTML += '</div>';

            content.innerHTML = `<h1 style="font-size:3rem">${data.grand_winner}</h1>${historyHTML}`;
        } else {
            title.innerText = `Round ${data.current_round} / ${data.total_rounds}`;
            content.innerText = data.active_q || "...";
            
            if (data.guess_state === 'ACTIVE') {
                $('stu-guess-input').classList.remove('hidden');
                if (data.active_q !== lastActiveQ) {
                    lastActiveQ = data.active_q;
                    runTimer(data.timer_end);
                }
            } else if (data.guess_state === 'WINNER') {
                const winners = data.round_winners || [];
                const lastWinner = winners[winners.length-1] || "None";
                content.innerHTML = `Winner: <b style="color:var(--green)">${lastWinner}</b><br>Ans: ${data.real_answer}`;
            }
        }
    }
}

// --- STUDENT ACTIONS ---

async function makeChoice(type) {
    $('stu-rng-choice').classList.add('hidden');
    const { data } = await supabase.from('tasks').select('text').eq('type', type);
    const text = data && data.length > 0 ? data[Math.floor(Math.random() * data.length)].text : "Do 10 Pushups";

    await supabase.from('rooms').update({
        rng_state: 'REVEALED',
        task_type: type,
        task_content: text
    }).eq('id', ROOM_ID);
}

async function submitConfess() {
    const txt = $('inp-confess').value;
    if(!txt) return;
    const { data } = await supabase.from('rooms').select('confess_theme').eq('id', ROOM_ID).single();
    await supabase.from('confessions').insert({ text: txt, theme: data.confess_theme });
    $('inp-confess').value = "";
}

async function submitGuess() {
    const val = parseInt($('inp-guess').value);
    await supabase.from('guesses').insert({ uid: myUid, name: myName, guess: val });
    $('btn-guess-submit').innerText = "LOCKED"; 
    $('btn-guess-submit').disabled = true;
}

async function castVote(v) {
    await supabase.from('votes').insert({ vote: v });
    $('stu-tribunal').classList.add('hidden');
}


// ======================================================
// 5. ADMIN LOGIC
// ======================================================

function startAdminListeners() {
    supabase.channel('admin-room').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${ROOM_ID}` }, 
    (payload) => {
        const d = payload.new;
        renderAdminUI(d.mode);
        $('admin-mode-title').innerText = d.mode;
        
        if(d.mode === 'GUESS') {
            $('admin-round-info').innerText = `Round ${d.current_round} / ${d.total_rounds}`;
            
            // Update Guess Display with Arrow History
            const history = d.round_winners || [];
            if(history.length > 0) {
                $('admin-guess-display').innerHTML = `<div style="font-size:0.9rem; color:gray;">${history.join(' <b style="color:var(--red)">→</b> ')}</div>`;
            } else {
                $('admin-guess-display').innerText = "No winners yet";
            }
        }
        
        if(d.mode === 'RNG' && d.current_victim) {
            $('admin-rng-display').innerText = `Victim: ${d.current_victim.name}`;
        }
    }).subscribe();

    supabase.from('rooms').select('*').eq('id', ROOM_ID).single().then(({data}) => { 
        if(data) { renderAdminUI(data.mode); $('admin-mode-title').innerText = data.mode; }
    });

    // Player List (Poll every 5s)
    setInterval(async () => {
        const { data } = await supabase.from('users').select('*').order('last_seen', { ascending: false });
        const list = $('player-list'); list.innerHTML = "";
        let onlineCount = 0;
        const now = new Date();
        data.forEach(u => {
            const isOnline = (now - new Date(u.last_seen)) < 120000;
            if(isOnline) onlineCount++;
            
            const div = document.createElement('div');
            div.className = 'player-item';
            div.innerHTML = `
                <div><span class="status ${isOnline?'online':''}"></span> ${u.name}</div>
                <div>
                    <button class="action-btn btn-purple" onclick="window.buzzUser('${u.uid}')">🔔</button>
                    <button class="action-btn btn-red" onclick="window.kickUser('${u.uid}')">🚫</button>
                </div>`;
            list.appendChild(div);
        });
        $('online-count').innerText = onlineCount;
    }, 5000);

    // Feed
    supabase.channel('admin-conf').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'confessions' }, 
    (p) => {
        const d = document.createElement('div');
        d.className = 'confess-card'; d.innerText = p.new.text;
        d.onclick = () => window.broadcastConfession(p.new.text);
        $('admin-confess-feed').prepend(d);
    }).subscribe();

    // Votes
    supabase.channel('admin-votes').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'votes' }, 
    () => updateVoteCount()).subscribe();
}

async function updateVoteCount() {
    const { count: pass } = await supabase.from('votes').select('*', { count: 'exact', head: true }).eq('vote', 'pass');
    const { count: fail } = await supabase.from('votes').select('*', { count: 'exact', head: true }).eq('vote', 'fail');
    $('admin-vote-stats').innerText = `Votes: ${pass} Pass / ${fail} Fail`;
}

function renderAdminUI(mode) {
    document.querySelectorAll('.admin-panel').forEach(el => el.classList.add('hidden'));
    if(mode === 'RNG') $('admin-ctrl-rng').classList.remove('hidden');
    if(mode === 'GUESS') $('admin-ctrl-guess').classList.remove('hidden');
    if(mode === 'CONFESS') $('admin-ctrl-confess').classList.remove('hidden');
}

// --- ADMIN ACTIONS ---

async function setMode(mode) {
    await supabase.from('rooms').update({ mode: mode }).eq('id', ROOM_ID);
}

async function resetRoom() {
    // Full Reset
    await supabase.from('rooms').update({ 
        mode: 'LOBBY', 
        broadcast_msg: '', 
        tribunal_active: false, 
        rng_state: 'IDLE', 
        guess_state: 'IDLE',
        active_q: '',
        task_content: '',
        current_victim: null,
        current_round: 0,
        total_rounds: 0,
        round_winners: [],
        recent_victims: []
    }).eq('id', ROOM_ID);
}

// RNG
// RNG
async function spinWheel() {
    $('admin-rng-display').innerText = "Spinning...";
    
    // 1. Set Spinning AND Reset Voting (Crucial Fix)
    await supabase.from('rooms').update({ 
        rng_state: 'SPINNING', 
        tribunal_active: false 
    }).eq('id', ROOM_ID);

    const { data: users } = await supabase.from('users').select('*');
    const online = users.filter(u => (new Date() - new Date(u.last_seen)) < 120000);
    
    if(!online.length) return $('admin-rng-display').innerText = "No Online Users";

    // Access direct column 'recent_victims' (Not game_state)
    const { data: room } = await supabase.from('rooms').select('recent_victims').eq('id', ROOM_ID).single();
    const recent = room.recent_victims || [];
    
    let candidates = online.filter(u => !recent.includes(u.uid));
    if(!candidates.length) candidates = online;

    const victim = candidates[Math.floor(Math.random() * candidates.length)];
    recent.push(victim.uid);
    if(recent.length > 5) recent.shift();

    setTimeout(async () => {
        await supabase.from('rooms').update({ 
            rng_state: 'CHOOSING', 
            current_victim: victim, 
            recent_victims: recent 
        }).eq('id', ROOM_ID);
        // We update the Admin UI immediately here for better feedback
        $('admin-rng-display').innerText = `Victim: ${victim.name}`;
    }, 2000);
}

async function forceReveal() {
    await supabase.from('rooms').update({ 
        rng_state: 'REVEALED', task_type: 'Force', task_content: "Admin Force: Do 5 Burpees" 
    }).eq('id', ROOM_ID);
}

async function toggleTribunal() {
    await supabase.from('votes').delete().neq('id', 0);
    await supabase.from('rooms').update({ tribunal_active: true }).eq('id', ROOM_ID);
    updateVoteCount();
}

// Confess
async function setTheme() {
    await supabase.from('rooms').update({ confess_theme: $('inp-theme').value }).eq('id', ROOM_ID);
}
async function clearBroadcast() {
    await supabase.from('rooms').update({ broadcast_msg: '' }).eq('id', ROOM_ID);
}

// Over/Under
async function startTourney(r) {
    await supabase.from('rooms').update({
        mode: 'GUESS', 
        guess_state: 'IDLE', 
        total_rounds: r, 
        current_round: 0, 
        round_winners: [],
        active_q: 'Waiting for Round 1...'
    }).eq('id', ROOM_ID);
}

async function nextQuestion() {
    const { data: qs } = await supabase.from('questions_ou').select('*');
    if(!qs.length) return alert("Upload Questions first!");
    const q = qs[Math.floor(Math.random() * qs.length)];
    
    const { data: room } = await supabase.from('rooms').select('current_round').eq('id', ROOM_ID).single();
    await supabase.from('rooms').update({
        guess_state: 'ACTIVE', 
        active_q: q.q, 
        real_answer: q.a,
        current_round: (room.current_round || 0) + 1,
        timer_end: Date.now() + 30000
    }).eq('id', ROOM_ID);
}

async function calcRoundWinner() {
    const { data: room } = await supabase.from('rooms').select('*').eq('id', ROOM_ID).single();
    const { data: guesses } = await supabase.from('guesses').select('*');
    
    let bestUser = "Nobody", bestDiff = 999999;
    const recent = guesses.filter(g => (Date.now() - new Date(g.created_at).getTime()) < 45000);
    
    recent.forEach(g => {
        const diff = Math.abs(room.real_answer - g.guess);
        if(diff < bestDiff) { bestDiff = diff; bestUser = g.name; }
    });

    let history = room.round_winners || [];
    history.push(bestUser);

    if(history.length >= room.total_rounds) {
        const counts = {}; let grand = "Draw", max = 0;
        history.forEach(w => { counts[w]=(counts[w]||0)+1; if(counts[w]>max){max=counts[w]; grand=w;} });
        await supabase.from('rooms').update({ guess_state: 'GRAND_WINNER', grand_winner: grand, round_winners: history }).eq('id', ROOM_ID);
    } else {
        await supabase.from('rooms').update({ guess_state: 'WINNER', round_winners: history }).eq('id', ROOM_ID);
    }
}

// Upload
function handleFileUpload(e) {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const json = JSON.parse(e.target.result);
            if(json.truths) for(let t of json.truths) await supabase.from('tasks').insert({type: 'Truth', text: t});
            if(json.dares) for(let d of json.dares) await supabase.from('tasks').insert({type: 'Dare', text: d});
            if(json.ou) for(let q of json.ou) await supabase.from('questions_ou').insert({q: q.q, a: q.a});
            alert("Uploaded!");
        } catch(err) { alert("Error: " + err.message); }
    };
    reader.readAsText(file);
}

// Utils
function switchScreen(id) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    $(id).classList.add('active');
}

function runTimer(endTime) {
    if(timerInterval) clearInterval(timerInterval);
    const display = $('timer-display');
    const btn = $('btn-guess-submit');
    btn.disabled = false; btn.innerText = "LOCK IN 🔒";
    
    timerInterval = setInterval(() => {
        const dist = endTime - Date.now();
        if(dist < 0) {
            clearInterval(timerInterval);
            display.innerText = "00";
            btn.disabled = true; btn.innerText = "TIME UP";
        } else {
            display.innerText = Math.floor(dist/1000);
        }
    }, 1000);
}

async function checkInit() {
    try {
        const { data: room } = await supabase.from('rooms').select('*').eq('id', ROOM_ID).single();
        if (!room) {
            await supabase.from('rooms').insert({ id: ROOM_ID, mode: 'LOBBY' });
        }
    } catch(e) {}
}
