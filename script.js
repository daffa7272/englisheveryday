// --- CONFIG & STATE ---
let apiKey = "";
let flashcards = [];
let notes = [];
let reviewItems = [];
let audioContext;
let weeklyGoals = {};
let weeklyProgress = {};
let testTimerInterval;
let loadingInterval;
let loadingProgress = 0;
let lastListeningAudio = null; // Untuk menyimpan data audio terakhir
let cachedSummaryAudio = { title: null, data: null, mimeType: null };
const appVersion = "4.0.1"; // Versi aplikasi saat ini

// --- DAILY PLAN RESET LOGIC ---
function checkAndResetDailyPlan() {
    const savedPlanDate = localStorage.getItem('planDate');
    if (!savedPlanDate) return;

    const today = getLocalDateString(); // <-- Gunakan fungsi baru

    if (savedPlanDate !== today) {
        localStorage.removeItem('planMode');
        localStorage.removeItem('currentPlanIndex');
        localStorage.removeItem('planDate');
        console.log('Daily plan progress has been reset for the new day.');
        // Beri notifikasi ke pengguna bahwa progres telah di-reset
        setTimeout(() => {
            showToast("Selamat datang kembali! Progres harian di-reset.", "success");
        }, 1000);
    }
}

const ALL_ACTIVITIES = [
    { id: 'startDailyPracticeBtn', name: 'Latihan Harian', icon: 'fa-pencil-alt' },
    { id: 'startWritingBtn', name: 'Writing the Text', icon: 'fa-pen-alt' },
    { id: 'startListeningBtn', name: 'Latihan Listening', icon: 'fa-headphones' },
    { id: 'startVocabTestBtn', name: 'Me vs Vocabulary', icon: 'fa-spell-check' },
    { id: 'startSpeakingBtn', name: 'Asisten Dialog', icon: 'fa-microphone-alt' },
];
// --- UI ELEMENTS ---
const loadingSpinner = document.getElementById('loadingSpinner');
const dashboardView = document.getElementById('dashboardView');
const featureContainer = document.getElementById('featureContainer');
const userLevelDisplay = document.getElementById('userLevelDisplay');
const levelText = document.getElementById('levelText');
const translationTooltip = document.getElementById('translationTooltip');
const translateSelectionBtn = document.getElementById('translateSelectionBtn');
const notesPanel = document.getElementById('notesPanel');




// --- UI & NAVIGATION ---

function showSection(sectionIdToShow) {
    window.scrollTo(0, 0);
    const allSections = featureContainer.querySelectorAll('.feature-section');
    if (sectionIdToShow) {
        dashboardView.classList.add('hidden');
        featureContainer.classList.remove('hidden');
        allSections.forEach(sec => sec.classList.add('hidden'));
        document.getElementById(sectionIdToShow).classList.remove('hidden');
    } else {
        dashboardView.classList.remove('hidden');
        featureContainer.classList.add('hidden');
        updateDashboardDisplay();
    }
}

function createSectionHeader(title) {
    return `<div class="flex justify-between items-center mb-6 border-b pb-4"><h3 class="text-2xl font-bold">${title}</h3><button class="back-to-dash-btn btn-secondary !py-2 !px-4 text-sm"><i class="fas fa-arrow-left mr-2"></i>Kembali</button></div>`;
}

function markdownToHtml(text) {
    const lines = text.split('\n');
    let html = '';
    let inList = false;
    let inTable = false;

    const applyInlineFormatting = (lineContent) => {
        return lineContent
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
    };

    for (let i = 0; i < lines.length; i++) {
        const trimmedLine = lines[i].trim();

        // --- LOGIKA BARU UNTUK TABEL ---
        if (trimmedLine.includes('|')) {
            // Bersihkan baris dari pipe di awal/akhir
            let cleanLine = trimmedLine;
            if (cleanLine.startsWith('|')) cleanLine = cleanLine.substring(1);
            if (cleanLine.endsWith('|')) cleanLine = cleanLine.slice(0, -1);

            const cells = cleanLine.split('|').map(c => c.trim());

            // Cek baris pemisah tabel (e.g., |---|---|)
            if (cells.every(c => c.match(/^-+$/))) {
                continue; // Lewati baris pemisah
            }

            if (!inTable) {
                html += '<table class="ai-table"><thead><tr>';
                cells.forEach(header => {
                    html += `<th>${applyInlineFormatting(header)}</th>`;
                });
                html += '</tr></thead><tbody>';
                inTable = true;
            } else {
                html += '<tr>';
                cells.forEach(cell => {
                    html += `<td>${applyInlineFormatting(cell)}</td>`;
                });
                html += '</tr>';
            }
            continue; // Lanjut ke baris berikutnya
        }
        // --- AKHIR LOGIKA TABEL ---

        // Jika bukan baris tabel, tutup tag tabel jika sebelumnya terbuka
        if (inTable) {
            html += '</tbody></table>';
            inTable = false;
        }
        // Jika bukan item daftar, tutup tag daftar jika sebelumnya terbuka
        if (!trimmedLine.startsWith('* ') && inList) {
            html += '</ul>';
            inList = false;
        }

        // Logika untuk heading, list, dan paragraf (tetap sama)
        if (trimmedLine.startsWith('### ')) {
            html += `<h3 class="text-lg font-semibold mt-4 mb-2">${applyInlineFormatting(trimmedLine.substring(4))}</h3>`;
        } else if (trimmedLine.startsWith('## ')) {
            html += `<h2 class="text-xl font-bold mt-5 mb-2 pb-1 border-b">${applyInlineFormatting(trimmedLine.substring(3))}</h2>`;
        } else if (trimmedLine.startsWith('# ')) {
            html += `<h1 class="text-2xl font-extrabold mt-6 mb-3 pb-2 border-b">${applyInlineFormatting(trimmedLine.substring(2))}</h1>`;
        } else if (trimmedLine.startsWith('* ')) {
            if (!inList) {
                html += '<ul class="list-disc list-inside space-y-1 my-2">';
                inList = true;
            }
            html += `<li>${applyInlineFormatting(trimmedLine.substring(2))}</li>`;
        } else {
            if (trimmedLine !== '') {
                html += `<p class="my-2">${applyInlineFormatting(trimmedLine)}</p>`;
            }
        }
    }

    // Tutup tag yang mungkin masih terbuka di akhir
    if (inTable) html += '</tbody></table>';
    if (inList) html += '</ul>';

    return html.replace(/<p><\/p>/g, '');
}
// --- DAILY NOTIFICATION SCHEDULER ---

async function setupDailyNotification() {
    if (!('Notification' in window)) {
        showToast("Browser ini tidak mendukung notifikasi.", "error");
        return;
    }

    let permission = Notification.permission;
    if (permission === 'default') {
        permission = await Notification.requestPermission();
        updateNotificationIconState();
    }
    if (permission !== 'granted') {
        showToast("Anda perlu mengizinkan notifikasi di pengaturan browser.", "error");
        return;
    }

    const isScheduled = localStorage.getItem('dailyNotificationScheduled') === 'true';

    if (isScheduled) {
        // --- Logika untuk MENONAKTIFKAN ---
        const userConfirmation = confirm("Notifikasi harian sudah aktif. Apakah Anda ingin menonaktifkannya?");
        if (userConfirmation) {
            console.log(`Membatalkan semua notifikasi terjadwal...`);
            // Kode tool call untuk membatalkan akan dijalankan di sini
            localStorage.removeItem('dailyNotificationScheduled'); // Hapus tanda
            updateNotificationIconState(); // Perbarui warna ikon
            showToast("Notifikasi harian telah dinonaktifkan.", "success");
        }
    } else {
        // --- Logika untuk MENGAKTIFKAN ---
        const userConfirmation = confirm("Apakah Anda ingin mengatur notifikasi 'Pengingat Belajar' setiap pukul 18:00?");
        if (userConfirmation) {
            console.log("Menjadwalkan notifikasi harian pada pukul 18:00...");
            // Kode tool call untuk menjadwalkan akan dijalankan di sini
            localStorage.setItem('dailyNotificationScheduled', 'true'); // Atur tanda
            updateNotificationIconState(); // Perbarui warna ikon
            showToast("Berhasil! Pengingat harian pukul 18:00 telah diatur.", "success");
        }
    }
}


// --- API & HELPERS ---
function showLoading(show, message = null) {
    const spinner = document.getElementById('loadingSpinner');
    const progressBar = document.getElementById('loadingProgressBar');
    const progressText = document.getElementById('loadingProgressText');
    const loadingMessage = document.getElementById('loadingMessage');

    if (show) {
        spinner.classList.remove('hidden');
        loadingProgress = 0;
        progressBar.style.width = '0%';
        progressText.textContent = 'Memuat... 0%';

        if (message) {
            loadingMessage.textContent = message;
        } else {
            loadingMessage.textContent = '';
        }

        loadingInterval = setInterval(() => {
            loadingProgress += Math.random() * 5;
            if (loadingProgress > 95) {
                loadingProgress = 95;
                clearInterval(loadingInterval);
            }
            progressBar.style.width = `${loadingProgress}%`;
            progressText.textContent = `Memuat... ${Math.round(loadingProgress)}%`;
        }, 100);
    } else {
        clearInterval(loadingInterval);
        loadingProgress = 100;
        progressBar.style.width = '100%';
        progressText.textContent = 'Selesai! 100%';

        setTimeout(() => {
            spinner.classList.add('hidden');
            progressBar.style.width = '0%'; // Reset for next time
        }, 500);
    }
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    toast.className = `fixed bottom-5 right-5 text-white py-3 px-5 rounded-lg shadow-lg transition-transform duration-300 transform ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
    toastMessage.textContent = message;
    toast.classList.remove('translate-y-full');
    setTimeout(() => { toast.classList.add('translate-y-full'); }, 3000);
}

async function callGeminiAPI(payload, model = 'gemini-2.5-flash-preview-05-20') {
    if (!apiKey) {
        throw new Error("Kunci API Gemini belum diatur. Silakan masukkan di menu Pengaturan.");
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    let delay = 1000;
    for (let i = 0; i < 5; i++) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let errorDetails = `Status: ${response.status}. ${response.statusText}`;
                if (response.status === 400) {
                    const errorJson = await response.json();
                    errorDetails = errorJson.error ? errorJson.error.message : errorDetails;
                    if (errorDetails.includes("API key not valid")) {
                        throw new Error("Kunci API yang Anda masukkan tidak valid. Harap periksa kembali.");
                    }
                }
                throw new Error(`API Error: ${errorDetails}`);
            }

            const result = await response.json();

            if (!result.candidates || result.candidates.length === 0) {
                const feedback = result.promptFeedback ? `Reason: ${result.promptFeedback.blockReason}` : 'No candidates returned from API.';
                throw new Error(`API request did not return content. ${feedback}`);
            }

            return result;

        } catch (error) {
            console.error(`Attempt ${i + 1} failed:`, error);
            if (i < 4) await new Promise(res => setTimeout(res, delay));
            delay *= 2;
        }
    }
    throw new Error("Panggilan API gagal setelah beberapa kali percobaan.");
}

function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

function pcmToWav(pcmData, sampleRate) {
    const numChannels = 1;
    const bytesPerSample = 2; // 16-bit
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    for (let i = 0; i < pcmData.length; i++) {
        view.setInt16(44 + i * 2, pcmData[i], true);
    }
    return new Blob([view], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

async function playAudio(base64Audio, mimeType) {
    try {
        if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') await audioContext.resume();

        const sampleRateMatch = mimeType.match(/rate=(\d+)/);
        if (!sampleRateMatch) {
            console.error("Could not parse sample rate from mimeType:", mimeType);
            return null;
        }
        const sampleRate = parseInt(sampleRateMatch[1], 10);
        const pcmData = base64ToArrayBuffer(base64Audio);
        const pcm16 = new Int16Array(pcmData);
        const wavBlob = pcmToWav(pcm16, sampleRate);
        const audioUrl = URL.createObjectURL(wavBlob);

        const audio = new Audio(audioUrl);
        audio.play().catch(e => console.error("Error playing audio:", e));
        return audio; // Return the audio element to attach 'ended' event listener
    } catch (error) {
        console.error("Failed to play audio:", error);
        showToast("Gagal memutar audio.", 'error');
        return null;
    }
}


function getLocalDateString() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// --- PERSONALIZATION & GOALS ---

function loadGoals() {
    const storedGoals = JSON.parse(localStorage.getItem('weeklyGoals')) || {};
    const storedProgress = JSON.parse(localStorage.getItem('weeklyProgress')) || {};
    const now = new Date();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;

    // Cek jika sudah lebih dari seminggu
    if (storedGoals.startDate && (now - new Date(storedGoals.startDate)) > oneWeek) {

        // --- BLOK KODE BARU: Simpan Progres Minggu Lalu ke Riwayat ---
        const goalHistory = JSON.parse(localStorage.getItem('goalHistory')) || [];
        let totalTarget = 0;
        let totalSelesai = 0;

        // Hitung total target dan yang selesai (hanya untuk kunci yang ada di progress)
        for (const key in storedProgress) {
            totalTarget += storedGoals[key] || 0;
            totalSelesai += storedProgress[key] || 0;
        }

        const completionRate = totalTarget > 0 ? Math.min(100, (totalSelesai / totalTarget) * 100) : 0;

        goalHistory.push({
            endDate: new Date().toISOString().split('T')[0],
            goals: storedGoals,
            progress: storedProgress,
            completionRate: completionRate
        });
        localStorage.setItem('goalHistory', JSON.stringify(goalHistory));
        // --- AKHIR BLOK KODE BARU ---

        // Reset untuk minggu baru (kode yang sudah ada)
        weeklyGoals = { toefl: 1 };
        weeklyProgress = { daily: 0, toefl: 0, listening: 0, speaking: 0, flashcards: 0, books: 0, psychotest: 0 };
        localStorage.removeItem('weeklyGoals');
        localStorage.setItem('weeklyProgress', JSON.stringify(weeklyProgress));
    } else {
        weeklyGoals = storedGoals;
        const defaultProgress = { daily: 0, toefl: 0, listening: 0, speaking: 0, flashcards: 0, books: 0, psychotest: 0 };
        weeklyProgress = { ...defaultProgress, ...storedProgress };
    }
    weeklyGoals.toefl = 1;
}

function updateDashboardDisplay() {
    // 1. Inisialisasi awal
    const userLevel = localStorage.getItem('userLevel');
    levelText.textContent = userLevel || 'Belum Dinilai';
    updateWeeklyTestStatus();
    loadGoals(); // Memuat 'weeklyGoals' dan 'weeklyProgress'

    // 2. Logika untuk Rencana Belajar Harian
    const dailyPlan = JSON.parse(localStorage.getItem('dailyStudyPlan')) || [];
    const planContainer = document.getElementById('dailyPlanContainer');
    if (dailyPlan.length > 0) {
        const planMode = localStorage.getItem('planMode');
        const currentPlanIndex = parseInt(localStorage.getItem('currentPlanIndex'), 10) || 0;
        const isPlanStarted = planMode === 'active';

        const progressText = isPlanStarted ? `Aktivitas ${currentPlanIndex + 1} dari ${dailyPlan.length}` : `${dailyPlan.length} Aktivitas Direncanakan`;
        const buttonText = isPlanStarted && currentPlanIndex > 0 ? 'Lanjutkan Rencana' : 'Mulai Rencana Belajar';

        const journeyHtml = dailyPlan.map((activityId, index) => {
            const activity = ALL_ACTIVITIES.find(a => a.id === activityId);
            let statusClass = 'pending';
            if (index < currentPlanIndex) {
                statusClass = 'completed';
            } else if (index === currentPlanIndex && isPlanStarted) {
                statusClass = 'current';
            }

            return `
            <div class="journey-step ${statusClass}" id="step-${index}">
                <i class="fas ${activity ? activity.icon : 'fa-question'}"></i>
                <div class="journey-step-label">${activity ? activity.name : ''}</div>
            </div>
        `;
        }).join('');

        planContainer.innerHTML = `
        <div class="dashboard-widget mb-8">
            <div class="flex flex-col md:flex-row justify-between md:items-center mb-4">
                <div>
                    <h3 class="widget-title">Peta Perjalanan Belajar Hari Ini</h3>
                    <p class="text-sm text-slate-500">${progressText}</p>
                </div>
                <button id="startOrContinuePlanBtn" class="btn-primary mt-4 md:mt-0">${buttonText}</button>
            </div>

            <div class="overflow-x-auto pb-4 -mx-6 px-6">
                <div class="plan-journey-container">
                    <div id="owlTracker">
                        <svg viewBox="0 0 100 100">${document.getElementById('greetingOwl')?.querySelector('svg')?.innerHTML || ''}</svg>
                    </div>
                    <div class="journey-track">
                        ${journeyHtml}
                    </div>
                </div>
            </div>
            </div>
    `;
        planContainer.classList.remove('hidden');

        // Kalkulasi dan atur posisi burung hantu setelah DOM di-render
        setTimeout(() => {
            const owlTracker = document.getElementById('owlTracker');
            const currentStepIndex = isPlanStarted ? currentPlanIndex : 0;
            const targetStep = document.getElementById(`step-${currentStepIndex}`);

            if (targetStep && owlTracker) {
                const stepRect = targetStep.getBoundingClientRect();
                const containerRect = targetStep.parentElement.getBoundingClientRect();
                const newLeft = (stepRect.left + stepRect.width / 2) - (containerRect.left) - (owlTracker.offsetWidth / 2);
                owlTracker.style.left = `${newLeft}px`;
                targetStep.scrollIntoView({
                    behavior: 'smooth',
                    inline: 'center',
                    block: 'nearest'
                });
            }
        }, 100);

        // --- Logika Baru untuk Mengisi Kartu Lencana ---
        // --- Logika Baru untuk Mengisi Kartu Lencana ---
        const xpLevelCard = document.getElementById('xpLevelCard');
        const xpTextCard = document.getElementById('xpTextCard'); // <-- Tambahkan ini
        const xpBarCard = document.getElementById('xpBarCard');

        // Pastikan semua elemen ada sebelum diisi
        if (xpLevelCard && xpTextCard && xpBarCard) {
            const xpForPreviousLevels = (userProfile.level - 1) * XP_FOR_LEVEL;
            const currentLevelXp = userProfile.xp - xpForPreviousLevels;
            const percentage = (currentLevelXp / XP_FOR_LEVEL) * 100;

            xpLevelCard.textContent = userProfile.level;
            xpTextCard.textContent = `${currentLevelXp} / ${XP_FOR_LEVEL} XP`; // <-- Tambahkan ini
            xpBarCard.style.width = `${Math.min(100, percentage)}%`;
        }
        // ---------------------------------------------
        // ---------------------------------------------

        const startOrContinueBtn = document.getElementById('startOrContinuePlanBtn');
        if (startOrContinueBtn) {
            startOrContinueBtn.addEventListener('click', () => {
                const plan = JSON.parse(localStorage.getItem('dailyStudyPlan')) || [];
                if (plan.length > 0) {
                    const indexToRun = isPlanStarted ? currentPlanIndex : 0;
                    localStorage.setItem('planMode', 'active');
                    localStorage.setItem('currentPlanIndex', indexToRun);
                    // --- TAMBAHAN: Simpan tanggal hari ini ---
                    localStorage.setItem('planDate', getLocalDateString());
                    // ----------------------------------------
                    document.getElementById(plan[indexToRun]).click();
                }
            }, { once: true });
        }
    } else {
        // Jika tidak ada rencana harian, tampilkan kartu ajakan versi BIRU
        planContainer.innerHTML = `
            <div class="dashboard-widget text-center bg-blue-50 border-blue-200 mb-8 py-5">
            <div class="p-3 inline-block rounded-lg bg-blue-100 text-blue-600 mb-3">
                <i class="fas fa-tasks fa-lg"></i>
            </div>
            <h3 class="widget-title">Rancang Rencana Belajar Anda!</h3>
            <p class="text-sm text-slate-600 mb-4">Buat rutinitas harian yang terstruktur untuk mencapai target Anda lebih cepat.</p>
            <button id="createFirstPlanBtn" class="btn-primary">Buat Rencana Sekarang</button>
        </div>
    `;
        planContainer.classList.remove('hidden');

        // Aktifkan tombol yang baru dibuat
        document.getElementById('createFirstPlanBtn').addEventListener('click', startPlanBuilder);
    }

    // 3. Logika untuk Target Mingguan (posisi sudah benar)
    const summaryContainer = document.getElementById('weeklyGoalsSummary');
    const goalsSet = Object.values(weeklyGoals).some(val => val > 0); // <-- 'goalsSet' didefinisikan di sini

    if (!goalsSet) { // <-- 'goalsSet' digunakan setelah didefinisikan
        summaryContainer.innerHTML = `<div class="text-center"><p class="text-slate-500">Anda belum mengatur target mingguan. Ayo mulai!</p><button id="setGoalsFromSummaryBtn" class="btn-primary mt-3 text-sm">Atur Target</button></div>`;
        summaryContainer.querySelector('#setGoalsFromSummaryBtn').addEventListener('click', manageGoals);
        return;
    }

    let summaryHtml = '<h3 class="text-lg font-bold mb-4">Progres Target Mingguan</h3><div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">';
    const weeklyGoalActivities = [
        { key: 'toefl', name: 'Tes Mingguan' }, { key: 'daily', name: 'Latihan Harian' },
        { key: 'listening', name: 'Listening' }, { key: 'speaking', name: 'Dialog' },
        { key: 'flashcards', name: 'Flashcard Baru' }, { key: 'books', name: 'Rangkuman Buku' },
        { key: 'psychotest', name: 'Psikotes' }
    ];
    const manualIncrementActivities = ['listening', 'speaking', 'books', 'psychotest'];

    weeklyGoalActivities.forEach(act => {
        if (weeklyGoals[act.key] > 0) {
            const progress = weeklyProgress[act.key] || 0;
            const target = weeklyGoals[act.key];
            const percentage = Math.min(100, (progress / target) * 100);
            const canIncrementManually = manualIncrementActivities.includes(act.key);

            summaryHtml += `
            <div class="flex items-center gap-2">
                <div class="flex-grow">
                    <p class="text-sm font-medium mb-1">${act.name}: ${progress} / ${target}</p>
                    <div class="progress-bar h-2"><div class="progress-bar-inner" style="width: ${percentage}%"></div></div>
                </div>
                ${canIncrementManually ? `<button data-activity-key="${act.key}" class="manual-progress-btn bg-blue-100 text-blue-700 font-bold w-7 h-7 rounded-full text-lg flex-shrink-0 hover:bg-blue-200">+</button>` : '<div class="w-7"></div>'}
            </div>`;
        }
    });

    summaryHtml += '</div>';
    summaryContainer.innerHTML = summaryHtml;
    summaryContainer.querySelectorAll('.manual-progress-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const activityKey = e.currentTarget.dataset.activityKey;
            const currentProgress = weeklyProgress[activityKey] || 0;
            const currentTarget = weeklyGoals[activityKey] || 0;

            if (currentProgress < currentTarget) {
                weeklyProgress[activityKey] = currentProgress + 1;
                localStorage.setItem('weeklyProgress', JSON.stringify(weeklyProgress));
                updateDashboardDisplay();
            } else {
                showToast("Target untuk aktivitas ini sudah tercapai!", "success");
            }
        });
    });
}


function manageGoals() {
    const goalsSection = document.getElementById('goalsSection');
    loadGoals();
    goalsSection.innerHTML = createSectionHeader('Target Mingguan') + `
                <p class="text-slate-600 mb-6">Atur jumlah sesi latihan yang ingin Anda selesaikan minggu ini.</p>
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-slate-700">Tes Mingguan TOEFL</label>
                        <input type="number" value="1" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm bg-slate-100" disabled>
                    </div>
                    <div>
                        <label for="dailyGoal" class="block text-sm font-medium text-slate-700">Jumlah Latihan Harian</label>
                        <input type="number" id="dailyGoal" value="${weeklyGoals.daily || 0}" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm" min="0">
                    </div>
                     <div>
                        <label for="listeningGoal" class="block text-sm font-medium text-slate-700">Jumlah Latihan Listening</label>
                        <input type="number" id="listeningGoal" value="${weeklyGoals.listening || 0}" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm" min="0">
                    </div>
                     <div>
                        <label for="speakingGoal" class="block text-sm font-medium text-slate-700">Jumlah Sesi Dialog</label>
                        <input type="number" id="speakingGoal" value="${weeklyGoals.speaking || 0}" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm" min="0">
                    </div>
                    <div>
                        <label for="flashcardsGoal" class="block text-sm font-medium text-slate-700">Jumlah Flashcard Baru</label>
                        <input type="number" id="flashcardsGoal" value="${weeklyGoals.flashcards || 0}" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm" min="0">
                    </div>
                     <div>
                        <label for="booksGoal" class="block text-sm font-medium text-slate-700">Jumlah Rangkuman Buku Dibaca</label>
                        <input type="number" id="booksGoal" value="${weeklyGoals.books || 0}" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm" min="0">
                    </div>
                     <div>
                        <label for="psychotestGoal" class="block text-sm font-medium text-slate-700">Jumlah Latihan Psikotes</label>
                        <input type="number" id="psychotestGoal" value="${weeklyGoals.psychotest || 0}" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm" min="0">
                    </div>
                    <button id="saveGoalsBtn" class="btn-primary w-full !mt-6">Simpan Target</button>
                </div>
            `;

    document.getElementById('saveGoalsBtn').addEventListener('click', () => {
        const isNew = !localStorage.getItem('weeklyGoals');

        weeklyGoals = {
            toefl: 1,
            daily: parseInt(document.getElementById('dailyGoal').value) || 0,
            listening: parseInt(document.getElementById('listeningGoal').value) || 0,
            speaking: parseInt(document.getElementById('speakingGoal').value) || 0,
            flashcards: parseInt(document.getElementById('flashcardsGoal').value) || 0,
            books: parseInt(document.getElementById('booksGoal').value) || 0,
            psychotest: parseInt(document.getElementById('psychotestGoal').value) || 0,
            startDate: isNew || !weeklyGoals.startDate ? new Date().toISOString() : weeklyGoals.startDate
        };

        if (isNew) {
            weeklyProgress = { daily: 0, toefl: 0, listening: 0, speaking: 0, flashcards: 0, books: 0, psychotest: 0 };
            localStorage.setItem('weeklyProgress', JSON.stringify(weeklyProgress));
        }

        localStorage.setItem('weeklyGoals', JSON.stringify(weeklyGoals));
        showToast('Target berhasil disimpan!');
        showSection(null);
    });

    showSection('goalsSection');
}

// Fungsi ini akan dipanggil setiap kali sebuah aktivitas dalam rencana selesai
function handleEndOfActivity() {
    const planMode = localStorage.getItem('planMode');
    if (planMode !== 'active') return; // Abaikan jika tidak dalam mode rencana

    // Ambil data yang diperlukan
    const dailyPlan = JSON.parse(localStorage.getItem('dailyStudyPlan')) || [];
    let currentPlanIndex = parseInt(localStorage.getItem('currentPlanIndex'), 10);

    // 1. Aktivitas apa yang SEHARUSNYA dikerjakan?
    const expectedActivityId = dailyPlan[currentPlanIndex];

    // 2. Aktivitas apa yang BARU SAJA selesai?
    const completedActivityId = sessionStorage.getItem('currentRunningActivityId');

    // Hapus catatan aktivitas yang baru selesai
    sessionStorage.removeItem('currentRunningActivityId');

    // --- 3. BANDINGKAN: Lanjutkan hanya jika cocok ---
    if (expectedActivityId !== completedActivityId) {
        console.log("Aktivitas yang diselesaikan tidak sesuai dengan rencana. Rencana tidak dilanjutkan.");
        return; // Berhenti di sini jika tidak cocok
    }
    // ------------------------------------------------

    // Jika cocok, lanjutkan alur seperti biasa
    const nextPlanIndex = currentPlanIndex + 1;

    if (nextPlanIndex < dailyPlan.length) {
        localStorage.setItem('currentPlanIndex', nextPlanIndex);
        const nextActivityId = dailyPlan[nextPlanIndex];
        showNextActivityModal(nextActivityId, nextPlanIndex + 1, dailyPlan.length);
    } else {
        localStorage.removeItem('planMode');
        localStorage.removeItem('currentPlanIndex');
        showToast("Kerja bagus! Rencana belajar harian telah selesai.", "success");
        setTimeout(() => showSection(null), 1000);
    }
}

function showNextActivityModal(nextActivityId, currentStep, totalSteps) {
    // Hapus modal lama jika ada untuk mencegah duplikasi
    document.getElementById('nextActivityModal')?.remove();

    const modalHtml = `
        <div id="nextActivityModal" class="fixed inset-0 bg-slate-900 bg-opacity-60 z-50 flex items-center justify-center p-4">
            <div class="bg-white p-8 rounded-xl shadow-xl text-center max-w-md w-full">
                <h3 class="text-xl font-bold mb-2">Aktivitas Selesai!</h3>
                <p class="text-slate-500 mb-6">Apa langkah Anda selanjutnya?</p>
                <div class="flex flex-col sm:flex-row gap-3">
                    <button id="makeNotesAndPauseBtn" class="btn-secondary flex-1">Buat Catatan & Jeda</button>
                    <button id="continueToNextActivityBtn" class="btn-primary flex-1">Lanjut ke Aktivitas ${currentStep}</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const continueBtn = document.getElementById('continueToNextActivityBtn');
    const makeNotesBtn = document.getElementById('makeNotesAndPauseBtn');
    const modal = document.getElementById('nextActivityModal');

    // Logika untuk tombol Lanjutkan
    continueBtn.addEventListener('click', () => {
        modal.remove();
        document.getElementById(nextActivityId).click(); // Jalankan aktivitas selanjutnya
    }, { once: true });

    // Logika untuk tombol Buat Catatan
    makeNotesBtn.addEventListener('click', () => {
        modal.remove();
        manageNotes(); // Buka panel catatan
        // Rencana akan terjeda. Pengguna bisa melanjutkannya dari dasbor nanti.
    }, { once: true });
}

document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('keydown', e => {
  // Blokir shortcut inspect umum
  if (
    e.key === 'F12' ||
    (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i') ||
    (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') ||
    (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'j') ||
    (e.ctrlKey && e.key.toLowerCase() === 'u')
  ) {
    e.preventDefault();
  }
});


// --- DAILY PLAN BUILDER FEATURE ---
function startPlanBuilder() {
    const planSection = document.getElementById('planBuilderSection');
    let currentPlan = JSON.parse(localStorage.getItem('dailyStudyPlan')) || [];

    const renderPlan = () => {
        const planList = document.getElementById('planList');
        planList.innerHTML = currentPlan.map((activityId, index) => {
            const activity = ALL_ACTIVITIES.find(a => a.id === activityId);
            return `<div class="flex items-center justify-between p-2 bg-slate-100 rounded-md">
                        <span>${index + 1}. ${activity.name}</span>
                        <button data-index="${index}" class="remove-plan-item text-red-500 hover:text-red-700">&times;</button>
                    </div>`;
        }).join('') || '<p class="text-slate-400 text-sm">Rencana Anda masih kosong.</p>';
    };

    planSection.innerHTML = `
        ${createSectionHeader('Perancang Rencana Belajar')}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
                <h4 class="font-bold mb-3">Pilih Aktivitas</h4>
                <div id="activityOptions" class="space-y-2">
                    ${ALL_ACTIVITIES.map(a => `<button data-id="${a.id}" class="add-plan-item w-full text-left p-3 border rounded-lg hover:bg-slate-50">${a.name}</button>`).join('')}
                </div>
            </div>
            <div>
                <h4 class="font-bold mb-3">Rencana Hari Ini</h4>
                <div id="planList" class="space-y-2 mb-4"></div>
                <button id="savePlanBtn" class="btn-primary w-full">Simpan Rencana</button>
            </div>
        </div>
    `;

    renderPlan();

    planSection.addEventListener('click', (e) => {
        if (e.target.closest('.add-plan-item')) {
            currentPlan.push(e.target.closest('.add-plan-item').dataset.id);
            renderPlan();
        }
        if (e.target.closest('.remove-plan-item')) {
            currentPlan.splice(e.target.closest('.remove-plan-item').dataset.index, 1);
            renderPlan();
        }
        if (e.target.id === 'savePlanBtn') {
            localStorage.setItem('dailyStudyPlan', JSON.stringify(currentPlan));
            showToast("Rencana belajar harian berhasil disimpan!");
            showSection(null); // Kembali ke dasbor
        }
    });

    showSection('planBuilderSection');
}

// --- SPACED REPETITION LOGIC ---
async function scheduleReview(itemId, type) {
    const schedule = JSON.parse(localStorage.getItem('reviewSchedule')) || [];
    const reviewDate = new Date(); // Schedule for immediate review
    const reviewItem = {
        id: `review_${Date.now()}`,
        itemId,
        type,
        lastReviewed: null,
        nextReviewDate: reviewDate.toISOString(),
        interval: 0,
        easeFactor: 2.5,
        repetition: 0
    };
    schedule.push(reviewItem);
    localStorage.setItem('reviewSchedule', JSON.stringify(schedule));
    showToast("Item ditambahkan ke sesi ulasan!");
    checkForReviews();
}
async function updateReviewSchedule(reviewId, correct) {
    let schedule = JSON.parse(localStorage.getItem('reviewSchedule')) || [];
    const itemIndex = schedule.findIndex(r => r.id === reviewId);
    if (itemIndex === -1) return;

    let item = schedule[itemIndex];
    let { repetition, interval, easeFactor } = item;

    if (correct) {
        repetition += 1;
        if (repetition === 1) {
            interval = 1; // 1 day
        } else if (repetition === 2) {
            interval = 6; // 6 days
        } else {
            interval = Math.round(item.interval * easeFactor);
        }
        easeFactor = Math.max(1.3, easeFactor + 0.1);
    } else {
        repetition = 0;
        interval = 1; // Reset to 1 day if incorrect
        easeFactor = Math.max(1.3, easeFactor - 0.2);
    }

    const nextReviewDate = new Date();
    nextReviewDate.setDate(new Date().getDate() + interval);

    schedule[itemIndex] = {
        ...item,
        lastReviewed: new Date().toISOString(),
        nextReviewDate: nextReviewDate.toISOString(),
        repetition,
        interval,
        easeFactor
    };
    localStorage.setItem('reviewSchedule', JSON.stringify(schedule));
}
async function checkForReviews() {
    const schedule = JSON.parse(localStorage.getItem('reviewSchedule')) || [];
    const now = new Date();

    // --- PERUBAHAN UTAMA DI SINI ---
    // Filter item yang sudah jatuh tempo DAN pastikan flashcard-nya masih ada
    reviewItems = schedule.filter(item => {
        const isDue = new Date(item.nextReviewDate) <= now;
        const cardExists = flashcards.some(fc => fc.id === item.itemId); // Cek keberadaan kartu
        return isDue && cardExists;
    });
    // --------------------------------

    const reminderSection = document.getElementById('reminderSection');
    const reviewCount = document.getElementById('reviewCount');
    if (reviewItems.length > 0) {
        reviewCount.textContent = reviewItems.length;
        reminderSection.classList.remove('hidden');
    } else {
        reminderSection.classList.add('hidden');
    }
}

function startReviewSession() {
    // --- VALIDASI REAL-TIME DIMULAI DI SINI ---
    const allFlashcards = JSON.parse(localStorage.getItem('flashcards')) || [];
    const schedule = JSON.parse(localStorage.getItem('reviewSchedule')) || [];
    const now = new Date();

    const validReviewItems = schedule.filter(item => {
        const isDue = new Date(item.nextReviewDate) <= now;
        const cardExists = allFlashcards.some(fc => fc.id === item.itemId);
        return isDue && cardExists;
    });
    // --- AKHIR VALIDASI REAL-TIME ---

    if (validReviewItems.length === 0) {
        showToast("Tidak ada item valid untuk diulas saat ini. Data sedang disinkronkan.", "error");
        document.getElementById('reminderSection').classList.add('hidden'); // Sembunyikan notifikasi
        return;
    }

    const flashcardsSection = document.getElementById('flashcardsSection');
    flashcardsSection.innerHTML = createSectionHeader('Sesi Ulasan Flashcard');
    const contentDiv = document.createElement('div');
    flashcardsSection.appendChild(contentDiv);

    let currentReviewIndex = 0;
    const renderCard = () => {
        if (currentReviewIndex >= validReviewItems.length) {
            contentDiv.innerHTML = `
                <div class="text-center py-12">
                    <i class="fas fa-check-circle text-5xl text-green-500 mb-4"></i>
                    <h3 class="text-2xl font-bold">Sesi Ulasan Selesai!</h3>
                    <p class="text-slate-500 mt-2">Kerja bagus! Semua item telah diulas.</p>
                </div>`;
            checkForReviews(); // Refresh notifikasi di dasbor
            return;
        }

        const reviewItem = validReviewItems[currentReviewIndex];
        const cardData = allFlashcards.find(fc => fc.id === reviewItem.itemId);

        // Pengecekan ini sekarang bersifat redundan, tapi baik untuk keamanan
        if (!cardData) {
            currentReviewIndex++;
            renderCard();
            return;
        }

        contentDiv.innerHTML = `
            <p class="text-center text-sm text-slate-500 mb-4">Mengulas Kartu ${currentReviewIndex + 1} dari ${validReviewItems.length}</p>
            <div class="flashcard-container mb-4">
                <div id="reviewFlashcard" class="flashcard">
                    <div class="flashcard-face flashcard-front text-3xl font-bold">${cardData.word}</div>
                    <div class="flashcard-face flashcard-back">
                        ${cardData.translation ? `<h4 class="text-2xl font-bold text-blue-600 mb-2">${cardData.translation}</h4>` : ''}
                        <p class="font-semibold text-sm definition-text">${cardData.definition}</p>
                        <p class="text-xs text-slate-500 italic mt-3">"${cardData.example}"</p>
                    </div>
                </div>
            </div>
            <div id="reviewControls" class="flex justify-center items-center space-x-4 mt-6">
                <button id="showAnswerBtn" class="btn-primary flex-grow">Lihat Jawaban</button>
            </div>
        `;

        document.getElementById('showAnswerBtn').addEventListener('click', () => {
            document.getElementById('reviewFlashcard').classList.add('is-flipped');
            document.getElementById('reviewControls').innerHTML = `
                <button id="forgotBtn" class="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-6 rounded-md">Lupa</button>
                <button id="rememberedBtn" class="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-6 rounded-md">Ingat</button>
            `;

            document.getElementById('forgotBtn').addEventListener('click', async () => {
                await updateReviewSchedule(reviewItem.id, false);
                currentReviewIndex++;
                renderCard();
            });

            document.getElementById('rememberedBtn').addEventListener('click', async () => {
                await updateReviewSchedule(reviewItem.id, true);
                currentReviewIndex++;
                renderCard();
            });
        });
    };

    renderCard();
    showSection('flashcardsSection');
}


// --- TOEFL FEATURES (DAILY & WEEKLY) ---

function updateWeeklyTestStatus() {
    clearInterval(testTimerInterval);
    const toeflCard = document.getElementById('startWeeklyTestBtn');
    const toeflStatus = document.getElementById('toeflStatus');
    const lastCompletionTime = localStorage.getItem('lastTestCompletionTime');
    if (!lastCompletionTime) {
        toeflCard.classList.remove('disabled');
        toeflStatus.textContent = "Uji kemampuan Anda & tentukan level baru setiap minggu.";
        return;
    }

    const nextAvailableTime = new Date(lastCompletionTime).getTime() + 7 * 24 * 60 * 60 * 1000;

    function updateTimer() {
        const now = new Date().getTime();
        const distance = nextAvailableTime - now;

        if (distance < 0) {
            clearInterval(testTimerInterval);
            toeflCard.classList.remove('disabled');
            toeflStatus.textContent = "Tes mingguan Anda sudah tersedia!";
            return;
        }

        toeflCard.classList.add('disabled');
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        toeflStatus.textContent = `Tersedia lagi dalam: ${days}h ${hours}j ${minutes}m`;
    }

    updateTimer();
    testTimerInterval = setInterval(updateTimer, 60000); // Update every minute
}

async function startDailyPractice() {
    sessionStorage.setItem('currentRunningActivityId', 'startDailyPracticeBtn');
    showLoading(true);
    const toeflSection = document.getElementById('toeflSection');
    toeflSection.innerHTML = createSectionHeader('Latihan Harian');
    const contentDiv = document.createElement('div');
    toeflSection.appendChild(contentDiv);

    try {
        const userLevel = localStorage.getItem('userLevel') || 'Intermediate';
        const payload = {
            contents: [{ parts: [{ text: `Generate 10 TOEFL-style multiple-choice grammar questions suitable for an '${userLevel}' level learner. Every question object must have: "question", "options" (array of 4 strings), "answer" (string, "A"-"D"), and "explanation" (string, in simple Indonesian). Format as a single JSON array of objects.` }] }],
            generationConfig: { responseMimeType: "application/json" }
        };
        const result = await callGeminiAPI(payload);
        let rawText = result.candidates[0].content.parts[0].text;
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const questions = JSON.parse(rawText);
        displayToeflQuestions(questions, contentDiv, false); // false for isWeeklyTest
        showSection('toeflSection');
    } catch (error) {
        console.error("Error generating daily practice:", error);
        showToast("Gagal memuat latihan harian.", 'error');
        showSection(null);
    } finally {
        showLoading(false);
    }
}

async function startWeeklyTest() {
    if (document.getElementById('startWeeklyTestBtn').classList.contains('disabled')) {
        showToast("Tes mingguan belum tersedia.", 'error');
        return;
    }

    showLoading(true, "Mempersiapkan sesi tes mingguan... Ini mungkin membutuhkan waktu sekitar 1 menit.");
    const toeflSection = document.getElementById('toeflSection');
    toeflSection.innerHTML = createSectionHeader('Tes Mingguan TOEFL');
    const contentDiv = document.createElement('div');
    toeflSection.appendChild(contentDiv);

    try {
        const payload = {
            contents: [{
                parts: [{
                    text: `Generate a complete, mixed TOEFL ITP style test with a total of 30 questions. The output must be a single JSON object with three keys: "text_comprehension", "structure", and "reading".
                    1. "text_comprehension": An array of 5 objects. Each object must have "script" (a short dialog or monologue text between 2-4 lines) and a "question_set" (an array with ONE question object).
                    2. "structure": An array of 15 questions. The first 5 are 'Structure/Sentence Completion'. The next 10 are 'Written Expression/Error Identification'. For Error Identification, the "question" must be a full sentence where the four options (A, B, C, D) are specific words/phrases from the sentence. In the question text itself, wrap these corresponding words/phrases with a <u> tag.
                    3. "reading": An object with a "passage" key (a 250-word academic text) and a "questions" key (an array of 10 questions about the passage).
                    Every question object, in all sections, must have: "question", "options" (array of 4 strings), "answer" (string, "A"-"D"), and "explanation" (string, in simple Indonesian).` }]
            }],
            generationConfig: { responseMimeType: "application/json" }
        };
        const result = await callGeminiAPI(payload);
        let rawText = result.candidates[0].content.parts[0].text;
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const testData = JSON.parse(rawText);

        displayIntegratedTest(testData, contentDiv);
        showSection('toeflSection');
    } catch (error) {
        console.error("Error generating TOEFL test:", error.message);
        showToast(`Gagal memuat tes TOEFL: ${error.message}`, 'error');
        showSection(null);
    } finally {
        showLoading(false);
    }
}

function displayIntegratedTest(testData, container) {
    // Mengubah 'TextComprehension' menjadi 'Listening' agar konsisten saat perhitungan skor
    const allTextCompQuestions = testData.text_comprehension.flatMap(item => item.question_set.map(q => ({ ...q, type: 'Listening', script: item.script })));
    const allStructureQuestions = testData.structure.map(q => ({ ...q, type: 'Structure' }));
    const allReadingQuestions = testData.reading.questions.map(q => ({ ...q, type: 'Reading', passage: testData.reading.passage }));

    const allQuestions = [...allTextCompQuestions, ...allStructureQuestions, ...allReadingQuestions];
    let currentQuestionIndex = 0;
    let userAnswers = {};

    const renderQuestion = () => {
        const q = allQuestions[currentQuestionIndex];
        let headerContent = '';

        if (currentQuestionIndex === 0) {
            headerContent = `<h3 class="text-xl font-bold mb-4 text-center">Bagian 1: Listening Comprehension</h3>`;
        } else if (currentQuestionIndex === allTextCompQuestions.length) {
            headerContent = `<h3 class="text-xl font-bold my-6 text-center border-t pt-6">Bagian 2: Structure and Written Expression</h3>`;
        } else if (currentQuestionIndex === allTextCompQuestions.length + allStructureQuestions.length) {
            headerContent = `<h3 class="text-xl font-bold my-6 text-center border-t pt-6">Bagian 3: Reading Comprehension</h3>`;
        }

        if (q.type === 'Listening') {
            let formattedScript = q.script.replace(/(\w+:)/g, '<br><br><b>$1</b>').trim();
            if (formattedScript.startsWith('<br><br>')) {
                formattedScript = formattedScript.substring(8);
            }
            headerContent += `<div class="mb-4 p-4 bg-cyan-50 rounded-lg"><p class="mb-2 text-slate-600 font-semibold">Baca dialog/monolog berikut untuk menjawab pertanyaan.</p><div class="text-slate-800 italic leading-relaxed">${formattedScript}</div></div>`;
        } else if (q.type === 'Reading' && (currentQuestionIndex === (allTextCompQuestions.length + allStructureQuestions.length) || allQuestions[currentQuestionIndex - 1].type !== 'Reading')) {
            headerContent += `<div class="bg-slate-50 p-4 rounded-lg mb-6 border max-h-72 overflow-y-auto"><h4 class="font-bold mb-2">Reading Passage</h4><p class="text-sm text-slate-700 leading-relaxed">${q.passage.replace(/\n/g, '<br>')}</p></div>`;
        }

        const questionHtml = `
                    <div class="mb-6">
                        <p class="font-semibold text-lg mb-4">${currentQuestionIndex + 1}. ${q.question}</p>
                        <div class="space-y-3">${q.options.map((opt, i) => {
            const optionLetter = String.fromCharCode(65 + i);
            const isChecked = userAnswers[currentQuestionIndex] === optionLetter ? 'checked' : '';

            // --- PERBAIKAN UTAMA ADA DI SINI ---
            // value dari input radio diubah menjadi 'optionLetter' (A,B,C,D) bukan 'opt' (teks jawaban)
            return `<label class="flex items-center p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
    <input type="radio" name="q_answer" value="${optionLetter}" class="mr-3 h-4 w-4 text-blue-600 border-slate-300 focus:ring-blue-500" ${isChecked}>
    <span>${optionLetter}. ${opt.replace(/^[A-D][\.\)]\s*/, '')}</span>
</label>`;
        }).join('')}</div>
                    </div>
                    <p class="text-center text-sm text-slate-500 mt-4">Soal ${currentQuestionIndex + 1} dari ${allQuestions.length}</p>
                    <div class="flex justify-between items-center mt-6">
                        <button id="prevQuestionBtn" class="btn-secondary" ${currentQuestionIndex === 0 ? 'disabled' : ''}>Sebelumnya</button>
                        <button id="nextQuestionBtn" class="btn-primary">${currentQuestionIndex === allQuestions.length - 1 ? 'Selesai' : 'Berikutnya'}</button>
                    </div>`;
        container.innerHTML = headerContent + questionHtml;

        const saveCurrentAnswer = () => {
            const selected = container.querySelector(`input[name="q_answer"]:checked`);
            if (selected) userAnswers[currentQuestionIndex] = selected.value; // Sekarang menyimpan 'A', 'B', dst.
        };

        document.getElementById('prevQuestionBtn').addEventListener('click', () => {
            saveCurrentAnswer();
            if (currentQuestionIndex > 0) {
                currentQuestionIndex--;
                renderQuestion();
            }
        });
        document.getElementById('nextQuestionBtn').addEventListener('click', () => {
            saveCurrentAnswer();
            if (!userAnswers[currentQuestionIndex]) {
                showToast("Silakan pilih jawaban.", 'error');
                return;
            }
            if (currentQuestionIndex < allQuestions.length - 1) {
                currentQuestionIndex++;
                renderQuestion();
            } else {
                finishIntegratedTest(allQuestions, userAnswers, testData);
            }
        });
    };

    renderQuestion();
    handleEndOfActivity();
}

function finishIntegratedTest(questions, userAnswers) {
    const container = document.getElementById('toeflSection');
    let totalScore = 0, listeningScore = 0, structureScore = 0, readingScore = 0;
    const incorrectAnswers = [];

    // Mengambil jumlah soal dari data asli untuk akurasi
    const totalListening = questions.filter(q => q.type === 'Listening').length;
    const totalStructure = questions.filter(q => q.type === 'Structure').length;
    const totalReading = questions.filter(q => q.type === 'Reading').length;

    questions.forEach((q, index) => {
        const userAnswer = userAnswers[index] || "Tidak dijawab";

        // --- PERBAIKAN LOGIKA PENGECEKAN ---
        // Sekarang perbandingan 'userAnswer' (misal: "A") dengan 'q.answer' (misal: "A") sudah benar.
        const isCorrect = userAnswer === q.answer;

        if (isCorrect) {
            totalScore++;
            if (q.type === 'Listening') listeningScore++;
            else if (q.type === 'Structure') structureScore++;
            else if (q.type === 'Reading') readingScore++;
        } else {
            incorrectAnswers.push({ question: q.question, explanation: q.explanation });
        }
    });

    let newLevel = 'Beginner';
    if (totalScore >= 24) newLevel = 'Advanced';
    else if (totalScore >= 15) newLevel = 'Intermediate';

    localStorage.setItem('userLevel', newLevel);
    localStorage.setItem('lastTestCompletionTime', new Date().toISOString());
    const testHistory = JSON.parse(localStorage.getItem('testHistory')) || [];
    testHistory.push({
        date: new Date().toISOString(),
        totalScore: totalScore,
        totalQuestions: questions.length,
        structureScore: structureScore,
        readingScore: readingScore,
        listeningScore: listeningScore, // Sekarang skor listening akan tercatat dengan benar
        incorrectAnswers: incorrectAnswers
    });
    localStorage.setItem('testHistory', JSON.stringify(testHistory));

    let resultsHtml = '<div><h3 class="text-xl font-bold mb-4">Ulasan Jawaban</h3>';
    questions.forEach((q, index) => {
        const userAnswer = userAnswers[index] || "Tidak dijawab";
        const isCorrect = userAnswer === q.answer;

        // Mengambil teks jawaban berdasarkan huruf opsi
        const userAnswerText = userAnswer !== "Tidak dijawab" ? q.options[userAnswer.charCodeAt(0) - 65] : "Tidak dijawab";
        const correctAnswerText = q.options[q.answer.charCodeAt(0) - 65];

        resultsHtml += `
                <div class="mb-4 p-4 rounded-lg border-l-4 ${isCorrect ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}">
                    <p class="font-semibold">${index + 1}. ${q.question}</p>
                    <p class="text-sm mt-2">Jawaban Anda: <span class="font-bold ${isCorrect ? 'text-green-700' : 'text-red-700'}">${userAnswer}. ${userAnswerText}</span></p>
                    ${!isCorrect ? `<p class="text-sm">Jawaban Benar: <span class="font-bold text-green-700">${q.answer}. ${correctAnswerText}</span></p>` : ''}
                    
                    <div class="mt-3 pt-3 border-t border-slate-200">
                        <p class="text-sm font-semibold text-slate-600">Penjelasan:</p>
                        <p class="text-sm text-slate-700 p-2 bg-slate-100 rounded-md">${q.explanation}</p>
                    </div>
                </div>`;
    });
    resultsHtml += '</div>';

    const scoreSummaryHtml = `
            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-8">
                <h2 class="text-2xl font-bold text-center mb-4">Hasil Tes Selesai</h2>
                <div class="text-center mb-4"><p class="text-slate-600">Level Baru Anda</p><p class="text-3xl font-extrabold text-blue-600 mt-1">${newLevel}</p></div>
                <div class="flex justify-around text-center border-t pt-4">
                     <div><p class="text-slate-500 text-sm">Listening</p><p class="font-bold text-xl">${listeningScore}/${totalListening}</p></div>
                    <div><p class="text-slate-500 text-sm">Structure</p><p class="font-bold text-xl">${structureScore}/${totalStructure}</p></div>
                    <div><p class="text-slate-500 text-sm">Reading</p><p class="font-bold text-xl">${readingScore}/${totalReading}</p></div>
                    <div><p class="text-slate-500 text-sm font-bold">Total</p><p class="font-bold text-xl">${totalScore}/${questions.length}</p></div>
                </div>
            </div>`;
    loadGoals();
    if (weeklyGoals.toefl) {
        weeklyProgress.toefl = (weeklyProgress.toefl || 0) + 1;
        localStorage.setItem('weeklyProgress', JSON.stringify(weeklyProgress));
    }
    container.innerHTML = createSectionHeader('Hasil Tes Mingguan') + scoreSummaryHtml + resultsHtml;
}



function showTestInstructions(part) {
    const modal = document.getElementById('testInstructionsModal');
    const titleEl = document.getElementById('instructionTitle');
    const textEl = document.getElementById('instructionText');
    const exampleEl = document.getElementById('instructionExample');
    let title, instructions, example;

    if (part === 'All' || part === 'TextComprehension') {
        title = 'Bagian 1: Pemahaman Teks';
        instructions = 'Pada bagian ini, Anda akan membaca dialog atau monolog singkat. Jawablah pertanyaan yang mengikuti berdasarkan informasi yang ada di dalam teks.';
        example = `<b>Contoh Teks:</b><br><i>Man: I can't believe how much work I have to do. Woman: Yeah, the deadline is approaching fast...</i><br><br><b>Contoh Pertanyaan:</b><br>What are the speakers mainly discussing?`;
    }
    if (part === 'All' || part === 'Structure') {
        title = 'Bagian 2: Structure and Written Expression';
        instructions = 'Bagian ini menguji kemampuan tata bahasa Anda. Terdiri dari dua jenis soal: melengkapi kalimat dan menemukan kesalahan dalam kalimat.';
        example = `<b>Contoh Soal:</b><br>The manager <u>suggested that</u> (A) <u>the meeting</u> (B) <u>should be</u> (C) postponed <u>until next week</u> (D).<br><i>(Jawaban yang benar adalah C karena kata "suggested" tidak perlu diikuti "should").</i>`;
    }
    if (part === 'All' || part === 'Reading') {
        title = 'Bagian 3: Reading Comprehension';
        instructions = 'Pada bagian ini, Anda akan membaca sebuah teks akademik. Jawablah semua pertanyaan yang mengikuti berdasarkan informasi yang dapat ditemukan di dalam teks tersebut.';
        example = `Teks akan ditampilkan di atas serangkaian pertanyaan yang berkaitan dengannya. Baca dengan teliti untuk menemukan jawaban yang paling akurat.`;
    }
    if (part === 'All') { // Special case for the main info button
        title = "Panduan Tes Mingguan";
        instructions = "Tes ini terdiri dari 3 bagian untuk menguji kemampuan Anda secara komprehensif.";
        example = `<b>1. Pemahaman Teks:</b> Membaca dialog/monolog singkat.<br><b>2. Structure:</b> Melengkapi kalimat & menemukan error.<br><b>3. Reading:</b> Memahami bacaan akademik.`;
    }

    titleEl.textContent = title;
    textEl.textContent = instructions;
    exampleEl.innerHTML = example;
    modal.classList.remove('hidden');
}

function displayToeflQuestions(questions, container, isWeeklyTest) {
    let currentQuestionIndex = 0;
    let userAnswers = {};
    let displayedPassage = null;

    const renderQuestion = () => {
        const q = questions[currentQuestionIndex];
        let passageHtml = '';
        if (q.passage && q.passage !== displayedPassage) {
            passageHtml = `<div class="bg-slate-50 p-4 rounded-lg mb-6 border max-h-64 overflow-y-auto"><h4 class="font-bold mb-2">Reading Passage</h4><p class="text-sm text-slate-700 leading-relaxed">${q.passage.replace(/\n/g, '<br>')}</p></div>`;
            displayedPassage = q.passage;
        }

        const questionHtml = `<div class="mb-6"><p class="font-semibold text-lg mb-4">${currentQuestionIndex + 1}. ${q.question}</p><div class="space-y-3">${q.options.map((opt, i) => {
            const optionLetter = String.fromCharCode(65 + i);
            const isChecked = userAnswers[currentQuestionIndex] === optionLetter ? 'checked' : '';
            return `<label class="flex items-center p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
                                <input type="radio" name="q_answer" value="${optionLetter}" class="mr-3 h-4 w-4 text-blue-600 border-slate-300 focus:ring-blue-500" ${isChecked}>
                                <span>${optionLetter}. ${opt}</span>
                            </label>`;
        }).join('')}</div></div><p class="text-center text-sm text-slate-500 mt-4">Soal ${currentQuestionIndex + 1} dari ${questions.length}</p><div class="flex justify-between items-center mt-6"><button id="prevQuestionBtn" class="btn-secondary" ${currentQuestionIndex === 0 ? 'disabled' : ''}>Sebelumnya</button><button id="nextQuestionBtn" class="btn-primary">${currentQuestionIndex === questions.length - 1 ? 'Selesai' : 'Berikutnya'}</button></div>`;

        container.innerHTML = passageHtml + questionHtml;

        // Save current answer before navigating
        const saveCurrentAnswer = () => {
            const selected = container.querySelector(`input[name="q_answer"]:checked`);
            if (selected) {
                userAnswers[currentQuestionIndex] = selected.value;
            }
        };

        document.getElementById('prevQuestionBtn').addEventListener('click', () => {
            saveCurrentAnswer();
            if (currentQuestionIndex > 0) {
                currentQuestionIndex--;
                renderQuestion();
            }
        });

        document.getElementById('nextQuestionBtn').addEventListener('click', () => {
            saveCurrentAnswer();
            if (!userAnswers[currentQuestionIndex]) {
                showToast("Silakan pilih jawaban.", 'error');
                return;
            }
            if (currentQuestionIndex < questions.length - 1) {
                currentQuestionIndex++;
                renderQuestion();
            } else {
                finishToeflTest(questions, userAnswers, container, isWeeklyTest);
            }
        });
    };
    renderQuestion();
}

async function finishToeflTest(questions, userAnswers, container, isWeeklyTest) {
    let score = 0;
    let resultsHtml = '<div><h3 class="text-xl font-bold mb-4">Ulasan Jawaban</h3>';

    if (isWeeklyTest) {
        // Jika ini adalah Tes Mingguan, berikan XP lebih besar
        addXP(150);
        updateUserStat('weeklyTests');
    } else {
        // Jika ini adalah Latihan Harian (kode Anda)
        addXP(25);
        updateUserStat('dailyPractices');
    }

    questions.forEach((q, index) => {
        const userAnswerLetter = userAnswers[index];
        const isCorrect = userAnswerLetter === q.answer;
        if (isCorrect) { score++; }

        const userAnswerText = userAnswerLetter ? q.options[userAnswerLetter.charCodeAt(0) - 65] : "Tidak dijawab";
        const correctAnswerText = q.options[q.answer.charCodeAt(0) - 65];

        resultsHtml += `
                <div class="mb-4 p-4 rounded-lg border-l-4 ${isCorrect ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}">
                    <p class="font-semibold">${index + 1}. ${q.question}</p>
                    <p class="text-sm mt-2">Jawaban Anda: <span class="font-bold ${isCorrect ? 'text-green-700' : 'text-red-700'}">${userAnswerLetter}. ${userAnswerText}</span></p>
                    ${!isCorrect ? `<p class="text-sm">Jawaban Benar: <span class="font-bold text-green-700">${q.answer}. ${correctAnswerText}</span></p>` : ''}
                    <div class="mt-3 pt-3 border-t border-slate-200">
                        <p class="text-sm font-semibold text-slate-600">Penjelasan:</p>
                        <p class="text-sm text-slate-700 p-2 bg-slate-100 rounded-md">${q.explanation}</p>
                    </div>
                </div>`;
    });
    resultsHtml += '</div>';

    let scoreSummaryHtml = '';

    if (isWeeklyTest) {
        let newLevel = 'Beginner';
        if (score >= 40) newLevel = 'Advanced';
        else if (score >= 25) newLevel = 'Intermediate';

        localStorage.setItem('userLevel', newLevel);
        localStorage.setItem('lastTestCompletionTime', new Date().toISOString());

        // Save test history
        const testHistory = JSON.parse(localStorage.getItem('testHistory')) || [];
        testHistory.push({
            date: new Date().toISOString(),
            totalScore: score,
            totalQuestions: questions.length,
            structureScore: structureScore,
            readingScore: readingScore,
            incorrectAnswers: incorrectAnswers // Save incorrect answers for analysis
        });
        localStorage.setItem('testHistory', JSON.stringify(testHistory));


        scoreSummaryHtml = `<div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-8"><h2 class="text-2xl font-bold text-center mb-4">Hasil Tes Selesai</h2><div class="text-center mb-4"><p class="text-slate-600">Level Baru Anda</p><p class="text-3xl font-extrabold text-blue-600 mt-1">${newLevel}</p></div><div class="flex justify-around text-center border-t pt-4"><div><p class="text-slate-500 text-sm">Benar</p><p class="font-bold text-2xl text-green-600">${score}</p></div><div><p class="text-slate-500 text-sm">Salah</p><p class="font-bold text-2xl text-red-600">${questions.length - score}</p></div><div><p class="text-slate-500 text-sm">Total Soal</p><p class="font-bold text-2xl">${questions.length}</p></div></div></div>`;

        loadGoals();
        if (weeklyGoals.toefl) {
            weeklyProgress.toefl = (weeklyProgress.toefl || 0) + 1;
            localStorage.setItem('weeklyProgress', JSON.stringify(weeklyProgress));
        }
    } else { // Daily Practice
        scoreSummaryHtml = `<div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-8"><h2 class="text-2xl font-bold text-center mb-4">Hasil Latihan Harian</h2><div class="flex justify-around text-center"><div><p class="text-slate-500 text-sm">Benar</p><p class="font-bold text-2xl text-green-600">${score}</p></div><div><p class="text-slate-500 text-sm">Salah</p><p class="font-bold text-2xl text-red-600">${questions.length - score}</p></div><div><p class="text-slate-500 text-sm">Total Soal</p><p class="font-bold text-2xl">${questions.length}</p></div></div></div>`;
        loadGoals();
        if (weeklyGoals.daily) {
            weeklyProgress.daily = (weeklyProgress.daily || 0) + 1;
            localStorage.setItem('weeklyProgress', JSON.stringify(weeklyProgress));
        }
    }

    const noteFormHtml = `
                <div class="mt-8 border-t pt-6">
                    <h3 class="text-xl font-bold mb-4">Buat Catatan Pembelajaran</h3>
                    <p class="text-slate-600 mb-4">Catat poin-poin penting atau materi yang masih kurang Anda pahami dari latihan ini.</p>
                    <button id="createPostTestNoteBtn" class="btn-primary">
                        <i class="fas fa-plus mr-2"></i>Buat Catatan
                    </button>
                </div>
            `;

    container.innerHTML = scoreSummaryHtml + resultsHtml + noteFormHtml;

    document.getElementById('createPostTestNoteBtn').addEventListener('click', (e) => {
        const title = `Catatan dari ${isWeeklyTest ? 'Tes Mingguan' : 'Latihan Harian'}`;
        manageNotes(title);
    });
    handleEndOfActivity();
}

// --- PROGRESS TRACKING FEATURE ---

async function viewProgress() {
    showLoading(true);
    const progressSection = document.getElementById('progressSection');
    progressSection.innerHTML = createSectionHeader('Progres Belajar Saya');
    const contentDiv = document.createElement('div');
    progressSection.appendChild(contentDiv);

    const testHistory = JSON.parse(localStorage.getItem('testHistory')) || [];
    const goalHistory = JSON.parse(localStorage.getItem('goalHistory')) || [];

    if (testHistory.length === 0 && goalHistory.length === 0) {
        contentDiv.innerHTML = `<div class="text-center py-12"><i class="fas fa-chart-line text-4xl text-slate-300 mb-4"></i><p class="text-slate-500">Anda belum memiliki riwayat tes atau target mingguan. Selesaikan "Tes Mingguan" atau satu siklus "Target Mingguan" untuk melihat progres Anda.</p></div>`;
        showLoading(false);
        showSection('progressSection');
        return;
    }

    contentDiv.innerHTML = `
        <div class="grid md:grid-cols-2 gap-8 mb-8">
            <div>
                <h4 class="text-xl font-bold mb-4">Perkembangan Skor Tes Mingguan</h4>
                <canvas id="scoreTrendChart"></canvas>
            </div>
            <div>
                <h4 class="text-xl font-bold mb-4">Konsistensi Penyelesaian Target Mingguan</h4>
                <canvas id="goalHistoryChart"></canvas>
            </div>
        </div>
        <div class="grid md:grid-cols-2 gap-8 mb-8">
            <div>
                <h4 class="text-xl font-bold mb-4">Rata-Rata Skor Tes per Bagian</h4>
                <canvas id="sectionScoresChart"></canvas>
            </div>
             <div>
                <h4 class="text-xl font-bold mb-4">Analisis Kesalahan Umum (AI)</h4>
                <div id="aiAnalysis" class="bg-blue-50 p-4 rounded-lg text-slate-700 text-sm h-full">Memuat analisis...</div>
            </div>
        </div>
    `;

    // Render Grafik Skor Tes (kode yang sudah ada)
    if (testHistory.length > 0) {
        const scoreLabels = testHistory.map(t => new Date(t.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }));
        const scoreData = testHistory.map(t => (t.totalScore / t.totalQuestions) * 100);
        new Chart(document.getElementById('scoreTrendChart'), {
            type: 'line',
            data: {
                labels: scoreLabels,
                datasets: [{
                    label: 'Skor Tes (%)',
                    data: scoreData,
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    fill: true,
                    tension: 0.1
                }]
            }
        });

        // Render Grafik Skor per Bagian (kode yang sudah ada)
        const avgStructure = testHistory.reduce((acc, t) => acc + (t.structureScore / 40), 0) / testHistory.length * 100;
        const avgReading = testHistory.reduce((acc, t) => acc + (t.readingScore / 10), 0) / testHistory.length * 100;
        new Chart(document.getElementById('sectionScoresChart'), {
            type: 'bar',
            data: {
                labels: ['Structure & Written Expression', 'Reading Comprehension'],
                datasets: [{
                    label: 'Akurasi Rata-Rata (%)',
                    data: [avgStructure.toFixed(1), avgReading.toFixed(1)],
                    backgroundColor: ['#3b82f6', '#10b981']
                }]
            },
            options: { indexAxis: 'y' }
        });
    }

    // --- KODE BARU: Render Grafik Riwayat Target ---
    if (goalHistory.length > 0) {
        const goalLabels = goalHistory.map(h => new Date(h.endDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }));
        const goalData = goalHistory.map(h => h.completionRate.toFixed(1));
        new Chart(document.getElementById('goalHistoryChart'), {
            type: 'line',
            data: {
                labels: goalLabels,
                datasets: [{
                    label: 'Penyelesaian Target (%)',
                    data: goalData,
                    borderColor: '#16a34a', // Warna hijau
                    backgroundColor: 'rgba(22, 163, 74, 0.1)',
                    fill: true,
                    tension: 0.1
                }]
            }
        });
    }

    showSection('progressSection');

    // Generate Analisis AI (kode yang sudah ada)
    const recentMistakes = testHistory.length > 0 ? testHistory[testHistory.length - 1].incorrectAnswers : [];
    if (recentMistakes.length > 0) {
        try {
            const mistakeText = recentMistakes.map(m => `Pertanyaan: ${m.question}\nPenjelasan: ${m.explanation}`).join('\n\n');
            const payload = {
                contents: [{ parts: [{ text: `Based on this list of recent incorrect answers and their explanations from a TOEFL test, analyze the user's common mistakes. Provide a summary in Indonesian focusing on 2-3 key areas for improvement. Format as a simple, encouraging paragraph.\n\n${mistakeText}` }] }]
            };
            const result = await callGeminiAPI(payload);
            document.getElementById('aiAnalysis').textContent = result.candidates[0].content.parts[0].text;
        } catch (error) {
            document.getElementById('aiAnalysis').textContent = "Gagal memuat analisis AI.";
            console.error("Error getting AI analysis:", error);
        }
    } else {
        document.getElementById('aiAnalysis').textContent = "Tidak ada riwayat kesalahan pada tes terakhir untuk dianalisis. Kerja bagus!";
    }
    showLoading(false);
}
// --- VOCABULARY TEST FEATURE ---

async function startVocabTest() {
    sessionStorage.setItem('currentRunningActivityId', 'startVocabTestBtn');
    const vocabSection = document.getElementById('vocabTestSection');
    vocabSection.innerHTML = createSectionHeader('Me vs Vocabulary');
    const contentDiv = document.createElement('div');
    vocabSection.appendChild(contentDiv);

    const categories = [
        "Office", "School", "Technology", "Home", "Travel", "Food",
        "Health", "Business", "Nature", "Finance", "Shopping", "Art",
        "Music", "Sports", "Weather", "Transportation", "Clothing", "Animals",
        "Science", "Emotions", "Government", "History", "Law", "Media"
    ];
    let selectedCategories = [];

    const buildRoulette = () => {
        const sliceAngle = 360 / categories.length;
        const skewAngle = 90 - sliceAngle;

        let rouletteHtml = `
                    <div class="roulette-container">
                        <div class="roulette-pointer"></div>
                        <div id="rouletteWheel" class="roulette-wheel">
                            ${categories.map((cat, i) => {
            const angle = sliceAngle * i;
            return `<div class="roulette-slice" style="transform: rotate(${angle}deg) skewY(-${skewAngle}deg);">
                                            <div class="slice-content" style="transform: skewY(${skewAngle}deg) rotate(${sliceAngle / 2}deg);">${cat}</div>
                                        </div>`;
        }).join('')}
                        </div>
                        <button id="spinBtn" class="btn-primary mt-4">Putar Roulette</button>
                        <div id="resultContainer" class="mt-4 text-center"></div>
                    </div>`;
        contentDiv.innerHTML = rouletteHtml;
        showSection('vocabTestSection');

        document.getElementById('spinBtn').addEventListener('click', spinTheWheel);
    };

    const spinTheWheel = () => {
        const spinBtn = document.getElementById('spinBtn');
        spinBtn.disabled = true;
        spinBtn.textContent = 'Berputar...';

        const wheel = document.getElementById('rouletteWheel');
        const sliceAngle = 360 / categories.length;

        const shuffled = [...categories].sort(() => 0.5 - Math.random());
        selectedCategories = shuffled.slice(0, 3);

        const targetCategory = selectedCategories[0];
        const targetIndex = categories.indexOf(targetCategory);
        const targetAngle = (360 - (targetIndex * sliceAngle)) - (sliceAngle / 2);

        const randomSpins = 5 + Math.floor(Math.random() * 3);
        const finalRotation = (360 * randomSpins) + targetAngle;

        wheel.style.transform = `rotate(${finalRotation}deg)`;

        setTimeout(() => {
            displayResults();
        }, 4500); // Match CSS transition duration
    };

    const displayResults = () => {
        const resultContainer = document.getElementById('resultContainer');
        resultContainer.innerHTML = `
                    <h3 class="text-xl font-bold">Kategori Terpilih:</h3>
                    <div class="flex justify-center gap-4 mt-2 flex-wrap">
                        ${selectedCategories.map(cat => `<span class="bg-teal-100 text-teal-800 font-semibold px-3 py-1 rounded-full">${cat}</span>`).join('')}
                    </div>
                    <button id="startVocabActualTestBtn" class="btn-primary mt-6">Mulai Tes!</button>
                `;
        document.getElementById('startVocabActualTestBtn').addEventListener('click', () => {
            generateAndDisplayVocabQuestions(selectedCategories, contentDiv);
        });
    };

    buildRoulette();
}

async function generateAndDisplayVocabQuestions(categories, container) {
    showLoading(true);
    try {
        const userLevel = localStorage.getItem('userLevel') || 'Intermediate';
        const payload = {
            contents: [{ parts: [{ text: `Generate 15 multiple-choice vocabulary questions for an '${userLevel}' level English learner. The questions must focus ONLY on these 3 categories: ${categories.join(', ')}. Distribute the questions among the categories. Each question must be a unique English sentence with one word underlined for translation into Indonesian. The output must be a single JSON array of objects. Each object must have these keys: "question" (the full sentence with the word to be translated enclosed in <u> and </u> tags), "options" (an array of 4 Indonesian translation choices), "answer" (the correct Indonesian translation from the options), and "explanation" (a brief explanation in Indonesian).` }] }],
            generationConfig: { responseMimeType: "application/json" }
        };
        const result = await callGeminiAPI(payload);
        let rawText = result.candidates[0].content.parts[0].text;
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const questions = JSON.parse(rawText);

        displayVocabQuestions(questions, container);
    } catch (error) {
        console.error("Error generating vocab test:", error);
        showToast("Gagal memuat soal Vocabulary.", 'error');
        showSection(null);
    } finally {
        showLoading(false);
    }
}

function displayVocabQuestions(questions, container) {
    let currentQuestionIndex = 0;
    let userAnswers = {};

    const renderQuestion = () => {
        const q = questions[currentQuestionIndex];
        const questionHtml = `<div class="mb-6">
                    <p class="font-semibold text-lg mb-4">${currentQuestionIndex + 1}. ${q.question}</p>
                    <div class="space-y-3">${q.options.map((opt, i) => { const optionLetter = String.fromCharCode(65 + i); return `<label class="flex items-center p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"><input type="radio" name="q_answer" value="${opt}" class="mr-3 h-4 w-4 text-blue-600 border-slate-300 focus:ring-blue-500"><span>${optionLetter}. ${opt}</span></label>`; }).join('')}</div>
                </div>
                <p class="text-center text-sm text-slate-500 mt-4">Soal ${currentQuestionIndex + 1} dari ${questions.length}</p>
                <div class="flex justify-end mt-6"><button id="nextQuestionBtn" class="btn-primary">${currentQuestionIndex === questions.length - 1 ? 'Selesai' : 'Berikutnya'}</button></div>`;

        container.innerHTML = questionHtml;

        document.getElementById('nextQuestionBtn').addEventListener('click', () => {
            const selected = container.querySelector(`input[name="q_answer"]:checked`);
            if (!selected) { showToast("Silakan pilih jawaban.", 'error'); return; }
            userAnswers[currentQuestionIndex] = selected.value;
            currentQuestionIndex++;
            if (currentQuestionIndex < questions.length) {
                renderQuestion();
            } else {
                finishVocabTest(questions, userAnswers);
            }
        });
    };
    renderQuestion();
}

function finishVocabTest(questions, userAnswers) {
    const container = document.getElementById('vocabTestSection');
    let score = 0;
    let resultsHtml = '<div><h3 class="text-xl font-bold mb-4">Ulasan Jawaban</h3>';
    addXP(35);
    updateUserStat('vocabTests');

    questions.forEach((q, index) => {
        const userAnswer = userAnswers[index];
        const isCorrect = userAnswer === q.answer;
        if (isCorrect) { score++; }

        const optionsHtml = q.options.map(opt => {
            if (opt === q.answer) return `<span class="font-bold text-green-700">${opt}</span>`;
            if (opt === userAnswer) return `<span class="font-bold text-red-700">${opt}</span>`;
            return `<span>${opt}</span>`;
        }).join(', ');

        resultsHtml += `<div class="mb-4 p-4 rounded-lg border-l-4 ${isCorrect ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}">
                    <p class="font-semibold">${index + 1}. ${q.question}</p>
                    <p class="text-sm mt-2">Jawaban Anda: <span class="font-bold ${isCorrect ? 'text-green-700' : 'text-red-700'}">${userAnswer}</span></p>
                    ${!isCorrect ? `<p class="text-sm">Jawaban Benar: <span class="font-bold text-green-700">${q.answer}</span></p>` : ''}
                    <div class="mt-3 pt-3 border-t border-slate-200">
                        <p class="text-sm font-semibold text-slate-600">Penjelasan:</p>
                        <p class="text-sm text-slate-500 italic">${q.explanation}</p>
                    </div>
                </div>`;
    });
    resultsHtml += '</div>';

    const scoreSummaryHtml = `<div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-8">
                <h2 class="text-2xl font-bold text-center mb-4">Hasil Latihan Vocabulary</h2>
                <div class="flex justify-around text-center">
                    <div><p class="text-slate-500 text-sm">Benar</p><p class="font-bold text-2xl text-green-600">${score}</p></div>
                    <div><p class="text-slate-500 text-sm">Salah</p><p class="font-bold text-2xl text-red-600">${questions.length - score}</p></div>
                    <div><p class="text-slate-500 text-sm">Total Soal</p><p class="font-bold text-2xl">${questions.length}</p></div>
                </div>
            </div>`;

    container.innerHTML = createSectionHeader('Hasil Latihan Vocabulary') + scoreSummaryHtml + resultsHtml;
    handleEndOfActivity();
}

// --- FLASHCARD & NOTES FEATURES ---
async function loadFlashcards() { flashcards = JSON.parse(localStorage.getItem('flashcards')) || []; }
async function loadNotes() { notes = JSON.parse(localStorage.getItem('notes')) || []; }
function saveNote(title, content, category) {
    const newNote = {
        id: `note_${Date.now()}`,
        title,
        content,
        category: category || "Umum",
        timestamp: new Date().toISOString()
    };
    notes.unshift(newNote); // Add to the beginning
    localStorage.setItem('notes', JSON.stringify(notes));
    showToast("Catatan berhasil disimpan!");
}

function renderReviewCalendar(container) {
    const schedule = JSON.parse(localStorage.getItem('reviewSchedule')) || [];

    const reviewsByDate = schedule.reduce((acc, item) => {
        const date = new Date(item.nextReviewDate).toISOString().split('T')[0];
        if (!acc[date]) {
            acc[date] = 0;
        }
        acc[date]++;
        return acc;
    }, {});

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const daysOfWeek = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let calendarHtml = `
                <h3 class="text-lg font-bold mb-4 text-slate-700">Jadwal Ulasan Anda</h3>
                <div class="bg-white p-4 rounded-lg border border-slate-200">
                    <div class="flex justify-between items-center mb-3">
                        <span class="text-lg font-semibold">${monthNames[month]} ${year}</span>
                    </div>
                    <table class="w-full text-center text-sm">
                        <thead>
                            <tr>
                                ${daysOfWeek.map(day => `<th class="py-2 text-slate-500 font-medium">${day}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
            `;

    let date = 1;
    let tableBodyHtml = '';
    for (let i = 0; i < 6; i++) {
        let row = '<tr>';
        for (let j = 0; j < 7; j++) {
            if (i === 0 && j < firstDayOfMonth) {
                row += '<td class="py-2"></td>';
            } else if (date > daysInMonth) {
                row += '<td class="py-2"></td>';
            } else {
                const currentDate = new Date(year, month, date);
                const dateString = currentDate.toISOString().split('T')[0];
                const isToday = date === now.getDate() && year === now.getFullYear() && month === now.getMonth();
                const reviewCount = reviewsByDate[dateString];

                let cellClass = 'py-2 relative';
                let dayClass = 'w-8 h-8 flex items-center justify-center mx-auto rounded-full';
                if (isToday) {
                    dayClass += ' bg-blue-600 text-white';
                }

                let markerHtml = '';
                if (reviewCount > 0) {
                    markerHtml = `<span class="absolute bottom-1 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-green-500 rounded-full"></span>`;
                }

                row += `<td class="${cellClass}">
                                    <div class="${dayClass}">${date}</div>
                                    ${markerHtml}
                                </td>`;
                date++;
            }
        }
        row += '</tr>';
        tableBodyHtml += row;
        if (date > daysInMonth) break;
    }

    calendarHtml += tableBodyHtml + '</tbody></table></div>';
    container.innerHTML = calendarHtml;
}

function manageFlashcards() {
    const flashcardsSection = document.getElementById('flashcardsSection');
    flashcardsSection.innerHTML = createSectionHeader('Flashcards') + `
        <div id="flashcardCalendarContainer" class="mb-8"></div>
        <div id="flashcardContent"></div>
    `;
    renderReviewCalendar(document.getElementById('flashcardCalendarContainer'));

    const contentContainer = document.getElementById('flashcardContent');
    let currentCardIndex = 0;

    // --- Helper Function untuk Tampilan Latihan ---
    const renderPracticeView = () => {
        let html = '';
        if (flashcards.length === 0) {
            html = `<div class="text-center py-12"><i class="fas fa-layer-group text-4xl text-slate-300 mb-4"></i><p class="text-slate-500">Anda belum punya flashcard. Tambahkan satu!</p></div>`;
        } else {
            const card = flashcards[currentCardIndex];
            html = `<p class="text-center text-sm text-slate-500 mb-4">Kartu ${currentCardIndex + 1} dari ${flashcards.length}</p><div class="flashcard-container mb-4"><div id="flashcard" class="flashcard"><div class="flashcard-face flashcard-front text-3xl font-bold">${card.word}</div><div class="flashcard-face flashcard-back"><p class="font-semibold text-lg definition-text">${card.definition}</p><p class="text-sm text-slate-500 italic mt-3">"${card.example}"</p></div></div></div><div class="flex justify-center items-center space-x-4 mt-6"><button id="prevCardBtn" class="p-3 h-12 w-12 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 disabled:opacity-50" ${currentCardIndex === 0 ? 'disabled' : ''}><i class="fas fa-arrow-left"></i></button><button id="flipCardBtn" class="btn-primary flex-grow">Balik Kartu</button><button id="nextCardBtn" class="p-3 h-12 w-12 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 disabled:opacity-50" ${currentCardIndex === flashcards.length - 1 ? 'disabled' : ''}><i class="fas fa-arrow-right"></i></button></div>`;
        }
        document.getElementById('flashcardTabView').innerHTML = html;
        if (flashcards.length > 0) {
            document.getElementById('flipCardBtn').addEventListener('click', () => document.getElementById('flashcard').classList.toggle('is-flipped'));
            document.getElementById('prevCardBtn').addEventListener('click', () => { if (currentCardIndex > 0) { currentCardIndex--; renderPracticeView(); } });
            document.getElementById('nextCardBtn').addEventListener('click', () => { if (currentCardIndex < flashcards.length - 1) { currentCardIndex++; renderPracticeView(); } });
        }
    };

    // --- Helper Function untuk Form Tambah Baru (sudah diperbarui sebelumnya) ---
    const renderAddForm = () => {
        const formHtml = `
        <div id="addCardForm" class="space-y-4">
            <div>
                <label for="newWord" class="block text-sm font-medium text-slate-700">Kata / Frasa (EN)</label>
                <div class="flex gap-2 mt-1">
                    <input type="text" id="newWord" class="block w-full rounded-md border-slate-300 shadow-sm" placeholder="e.g., Profound">
                    <button id="autofillBtn" class="btn-secondary whitespace-nowrap !py-2 !px-4">
                        <i class="fas fa-magic mr-2"></i> Isi Otomatis
                    </button>
                </div>
            </div>
            <div>
                <label for="newTranslation" class="block text-sm font-medium text-slate-700">Arti Kata (ID)</label>
                <input type="text" id="newTranslation" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm" placeholder="Akan diisi oleh AI...">
            </div>
            <div>
                <label for="newDefinitionEN" class="block text-sm font-medium text-slate-700">Definisi (EN)</label>
                <textarea id="newDefinitionEN" rows="3" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm" placeholder="Akan diisi oleh AI..."></textarea>
            </div>
            <div>
                <label for="newDefinitionID" class="block text-sm font-medium text-slate-700">Terjemahan Definisi (ID)</label>
                <textarea id="newDefinitionID" rows="3" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm" placeholder="Akan diisi oleh AI..."></textarea>
            </div>
            <div>
                <label for="newExample" class="block text-sm font-medium text-slate-700">Contoh Kalimat (EN)</label>
                <textarea id="newExample" rows="2" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm" placeholder="Akan diisi oleh AI..."></textarea>
            </div>

            <button id="saveCardBtn" class="w-full btn-primary !mt-6">Simpan Flashcard</button>
        </div>`;

        document.getElementById('flashcardTabView').innerHTML = formHtml;

        // --- Logika Baru untuk Autofill dan Save ---
        const wordInput = document.getElementById('newWord');
        const transInput = document.getElementById('newTranslation');
        const defEnInput = document.getElementById('newDefinitionEN');
        const defIdInput = document.getElementById('newDefinitionID');
        const exInput = document.getElementById('newExample');
        const autofillBtn = document.getElementById('autofillBtn');
        const saveBtn = document.getElementById('saveCardBtn');

        autofillBtn.addEventListener('click', async () => {
            const word = wordInput.value.trim();
            if (!word) {
                showToast("Harap masukkan kata terlebih dahulu.", "error");
                return;
            }

            autofillBtn.disabled = true;
            autofillBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Memuat...';

            try {
                const payload = {
                    contents: [{ parts: [{ text: `For the English word or phrase "${word}", provide its Indonesian translation, a concise English definition, the Indonesian translation of that definition, and a simple English example sentence. Format the output as a single JSON object with four keys: "translation", "definition_en", "definition_id", and "example".` }] }],
                    generationConfig: { responseMimeType: "application/json" }
                };
                const result = await callGeminiAPI(payload);
                const data = JSON.parse(result.candidates[0].content.parts[0].text);

                transInput.value = data.translation;
                defEnInput.value = data.definition_en;
                defIdInput.value = data.definition_id;
                exInput.value = data.example;

            } catch (error) {
                console.error("Failed to autofill flashcard:", error);
                showToast("Gagal mengambil data dari AI.", "error");
            } finally {
                autofillBtn.disabled = false;
                autofillBtn.innerHTML = '<i class="fas fa-magic mr-2"></i> Isi Otomatis';
            }
        });

        saveBtn.addEventListener('click', async () => {
            const combinedDefinition = `${defEnInput.value.trim()}\n(Artinya: ${defIdInput.value.trim()})`;

            const newCard = {
                id: `card_${Date.now()}`,
                word: wordInput.value.trim(),
                translation: transInput.value.trim(), // <-- TAMBAHKAN BARIS INI
                definition: combinedDefinition,
                example: exInput.value.trim()
            };

            if (!newCard.word || !defEnInput.value.trim() || !newCard.example) {
                showToast("Harap isi semua kolom.", 'error');
                return;
            }

            showLoading(true);
            flashcards.push(newCard);
            localStorage.setItem('flashcards', JSON.stringify(flashcards));
            await scheduleReview(newCard.id, 'flashcard');
            addXP(5);
            updateUserStat('flashcardsCreated');
            loadGoals();
            if (weeklyGoals.flashcards) {
                weeklyProgress.flashcards = (weeklyProgress.flashcards || 0) + 1;
                localStorage.setItem('weeklyProgress', JSON.stringify(weeklyProgress));
            }

            showToast("Flashcard berhasil disimpan!", 'success');
            currentCardIndex = flashcards.length - 1;
            renderReviewCalendar(document.getElementById('flashcardCalendarContainer'));
            document.getElementById('practiceTabBtn').click(); // Pindah ke tab latihan kartu
            showLoading(false);
        });
    };

    // --- Helper Function BARU untuk Tampilan Kelola Kartu ---
    const renderManageView = () => {
        let html = '<div class="space-y-4">';
        if (flashcards.length === 0) {
            html += `<p class="text-slate-500 text-center">Tidak ada kartu untuk dikelola.</p>`;
        } else {
            flashcards.forEach((card, index) => {
                html += `
                    <div class="p-4 border rounded-lg flex justify-between items-start">
                        <div>
                           <h4 class="font-bold">${card.word} <span class="text-base font-normal text-slate-500">- ${card.translation || ''}</span></h4>
                            <p class="text-sm text-slate-500 mt-1 definition-text">${card.definition}</p>
                        </div>
                        <div class="flex gap-2 flex-shrink-0 ml-4">
                            <button class="edit-card-btn text-blue-500 hover:text-blue-700" data-index="${index}"><i class="fas fa-edit"></i></button>
                            <button class="delete-card-btn text-red-500 hover:text-red-700" data-id="${card.id}"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                `;
            });
        }
        html += '</div>';
        document.getElementById('flashcardTabView').innerHTML = html;

        // Logika untuk tombol Hapus dan Edit
        document.getElementById('flashcardTabView').addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.delete-card-btn');
            const editBtn = e.target.closest('.edit-card-btn');

            if (deleteBtn) {
                const cardId = deleteBtn.dataset.id;
                if (confirm('Apakah Anda yakin ingin menghapus kartu ini?')) {
                    // Hapus kartu dari daftar utama
                    flashcards = flashcards.filter(card => card.id !== cardId);
                    localStorage.setItem('flashcards', JSON.stringify(flashcards));

                    // --- TAMBAHAN: Hapus juga jadwal ulasannya ---
                    let schedule = JSON.parse(localStorage.getItem('reviewSchedule')) || [];
                    schedule = schedule.filter(item => item.itemId !== cardId);
                    localStorage.setItem('reviewSchedule', JSON.stringify(schedule));
                    // --------------------------------------------

                    showToast('Kartu dan jadwal ulasannya berhasil dihapus.');
                    renderManageView(); // Render ulang tampilan
                    checkForReviews(); // Perbarui notifikasi ulasan di dasbor
                }
            }

            if (editBtn) {
                const cardIndex = parseInt(editBtn.dataset.index, 10);
                const card = flashcards[cardIndex];
                const newTranslation = prompt('Edit Arti Kata (ID):', card.translation || '');

                const newWord = prompt('Edit Kata / Frasa:', card.word);
                // Definisi dipisah lagi untuk diedit, lalu digabung kembali
                const currentDef = card.definition.split('\n(Artinya:');
                const currentDefEN = currentDef[0];
                const currentDefID = currentDef.length > 1 ? currentDef[1].slice(1, -1) : '';

                const newDefEN = prompt('Edit Definisi (EN):', currentDefEN);
                const newDefID = prompt('Edit Terjemahan Definisi (ID):', currentDefID);
                const newExample = prompt('Edit Contoh Kalimat:', card.example);

                if (newWord && newDefEN && newExample) {
                    flashcards[cardIndex].word = newWord;
                    flashcards[cardIndex].translation = newTranslation;
                    flashcards[cardIndex].definition = `${newDefEN}\n(Artinya: ${newDefID})`;
                    flashcards[cardIndex].example = newExample;

                    localStorage.setItem('flashcards', JSON.stringify(flashcards));
                    showToast('Kartu berhasil diperbarui.');
                    renderManageView(); // Render ulang tampilan
                }
            }
        });
    };

    // --- Struktur Utama dengan 3 Tab ---
    const initialHtml = `
        <div class="mb-4 border-b border-slate-200">
            <button id="practiceTabBtn" class="tab-btn py-2 px-4 font-semibold border-b-2 border-blue-500 text-blue-600">Latihan Kartu</button>
            <button id="addTabBtn" class="tab-btn py-2 px-4 font-semibold text-slate-500 hover:text-blue-600">Tambah Baru</button>
            <button id="manageTabBtn" class="tab-btn py-2 px-4 font-semibold text-slate-500 hover:text-blue-600">Kelola Kartu</button>
        </div>
        <div id="flashcardTabView"></div>
    `;
    contentContainer.innerHTML = initialHtml;

    const tabs = contentContainer.querySelectorAll('.tab-btn');
    const switchTab = (activeTab) => {
        tabs.forEach(tab => {
            tab.classList.remove('border-b-2', 'border-blue-500', 'text-blue-600');
            if (tab === activeTab) {
                tab.classList.add('border-b-2', 'border-blue-500', 'text-blue-600');
            }
        });
        if (activeTab.id === 'practiceTabBtn') renderPracticeView();
        else if (activeTab.id === 'addTabBtn') renderAddForm();
        else if (activeTab.id === 'manageTabBtn') renderManageView();
    };

    tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab)));

    renderPracticeView(); // Tampilan awal adalah tab latihan
    showSection('flashcardsSection');
}

function manageNotes(prefilledTitle = '') {
    const notesPanelContent = document.getElementById('notesPanelContent');

    const uniqueCategories = [...new Set(notes.map(note => note.category))];

    notesPanelContent.innerHTML = `
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-2xl font-bold">Catatan Belajar</h3>
                    <button id="closeNotesBtn" class="p-2 w-8 h-8 rounded-full hover:bg-slate-200 flex items-center justify-center">&times;</button>
                </div>
                 <!-- Filter/Search Form -->
                <div class="mb-6 p-4 bg-slate-50 rounded-lg">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label for="searchCategory" class="block text-sm font-medium text-slate-700">Filter Kategori</label>
                            <select id="searchCategory" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm text-sm">
                                <option value="">Semua Kategori</option>
                                ${uniqueCategories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label for="searchDate" class="block text-sm font-medium text-slate-700">Tanggal</label>
                            <input type="date" id="searchDate" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm text-sm">
                        </div>
                    </div>
                    <div class="flex gap-4 mt-3">
                         <button id="filterNotesBtn" class="btn-primary text-sm flex-1">Filter</button>
                         <button id="resetFilterBtn" class="btn-secondary text-sm flex-1">Reset</button>
                    </div>
                </div>


                <!-- Form Tambah Catatan -->
                <div class="mb-6">
                    <h4 class="font-bold mb-3">Tambah Catatan Baru</h4>
                    <form id="noteForm">
                        <div class="mb-3">
                            <label for="noteTitle" class="block text-sm font-medium text-slate-700">Judul</label>
                            <input type="text" id="noteTitle" value="${prefilledTitle}" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm" required>
                        </div>
                        <div class="mb-3">
                            <label for="noteCategory" class="block text-sm font-medium text-slate-700">Kategori</label>
                            <input type="text" id="noteCategory" list="categorySuggestions" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm" placeholder="Ketik atau pilih kategori..." required>
                            <datalist id="categorySuggestions">
                                ${uniqueCategories.map(cat => `<option value="${cat}">`).join('')}
                            </datalist>
                        </div>
                        <div class="mb-3">
                            <label for="noteContent" class="block text-sm font-medium text-slate-700">Isi Catatan</label>
                            <textarea id="noteContent" rows="4" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm" required></textarea>
                        </div>
                        <button type="submit" class="btn-primary w-full">Simpan</button>
                    </form>
                </div>

                <!-- Daftar Catatan -->
                <div class="border-t pt-4">
                    <div id="notesListContainer"></div>
                </div>
            `;

    renderNotesList();

    document.getElementById('closeNotesBtn').addEventListener('click', () => {
        notesPanel.classList.add('translate-x-full');
    });
    document.getElementById('noteForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const title = document.getElementById('noteTitle').value.trim();
        const category = document.getElementById('noteCategory').value.trim();
        const content = document.getElementById('noteContent').value.trim();
        saveNote(title, content, category);
        manageNotes(); // Re-render the panel
    });
    document.getElementById('filterNotesBtn').addEventListener('click', () => {
        const category = document.getElementById('searchCategory').value;
        const date = document.getElementById('searchDate').value;
        renderNotesList(category, date);
    });
    document.getElementById('resetFilterBtn').addEventListener('click', () => {
        document.getElementById('searchCategory').value = '';
        document.getElementById('searchDate').value = '';
        renderNotesList();
    });

    notesPanel.classList.remove('translate-x-full');
}

function renderNotesList(categoryFilter = '', dateFilter = '') {
    const container = document.getElementById('notesListContainer');
    if (!container) return;

    let filteredNotes = notes;

    if (categoryFilter) {
        filteredNotes = filteredNotes.filter(note => note.category === categoryFilter);
    }
    if (dateFilter) {
        filteredNotes = filteredNotes.filter(note => new Date(note.timestamp).toISOString().split('T')[0] === dateFilter);
    }

    const groupedNotes = filteredNotes.reduce((acc, note) => {
        if (!acc[note.category]) {
            acc[note.category] = [];
        }
        acc[note.category].push(note);
        return acc;
    }, {});

    let notesHtml = '';
    if (filteredNotes.length === 0) {
        notesHtml = `<div class="text-center py-12"><i class="fas fa-search text-4xl text-slate-300 mb-4"></i><p class="text-slate-500">Tidak ada catatan yang cocok dengan filter Anda.</p></div>`;
    } else {
        for (const category in groupedNotes) {
            notesHtml += `<h4 class="font-bold text-lg text-indigo-700 mt-6 mb-3">${category}</h4>`;
            groupedNotes[category].forEach(note => {
                notesHtml += `
                        <div class="bg-yellow-50 p-4 rounded-lg border border-yellow-200 mb-4 relative group">
                            <div class="flex justify-between items-center">
                                <h5 class="font-bold text-yellow-800">${note.title}</h5>
                                <small class="text-yellow-600">${new Date(note.timestamp).toLocaleDateString('id-ID')}</small>
                            </div>
                            <p class="mt-2 text-slate-700 whitespace-pre-wrap">${note.content}</p>
                             <button class="delete-note-btn absolute top-2 right-2 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity" data-id="${note.id}" title="Hapus Catatan">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                        `;
            });
        }
    }
    container.innerHTML = notesHtml;

    container.querySelectorAll('.delete-note-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const noteId = e.currentTarget.dataset.id;
            notes = notes.filter(note => note.id !== noteId);
            localStorage.setItem('notes', JSON.stringify(notes));
            showToast("Catatan dihapus.");
            renderNotesList(document.getElementById('searchCategory').value, document.getElementById('searchDate').value);
        });
    });
}


// --- QUICK FLASHCARD CREATION LOGIC ---
// --- QUICK FLASHCARD CREATION LOGIC ---
const showAddFlashcardModal = async (word) => {
    const modal = document.getElementById('addFlashcardModal');
    const wordInput = document.getElementById('fcWord');
    const transInput = document.getElementById('fcTranslation');
    const defEnInput = document.getElementById('fcDefinitionEN');
    const defIdInput = document.getElementById('fcDefinitionID');
    const exInput = document.getElementById('fcExample');
    const saveBtn = document.getElementById('saveQuickFlashcardBtn');
    const cancelBtn = document.getElementById('cancelAddFlashcardBtn');

    // Reset form
    wordInput.value = word;
    transInput.value = '';
    defEnInput.value = '';
    defIdInput.value = '';
    exInput.value = '';
    transInput.placeholder = 'Memuat arti kata...';
    defEnInput.placeholder = 'Memuat definisi dari AI...';
    defIdInput.placeholder = 'Memuat terjemahan definisi...';
    exInput.placeholder = 'Memuat contoh dari AI...';
    modal.classList.remove('hidden');

    try {
        // Perbarui prompt untuk meminta semua informasi baru
        const payload = {
            contents: [{ parts: [{ text: `For the English word or phrase "${word}", provide its Indonesian translation, a concise English definition, the Indonesian translation of that definition, and a simple English example sentence. Format the output as a single JSON object with four keys: "translation", "definition_en", "definition_id", and "example".` }] }],
            generationConfig: { responseMimeType: "application/json" }
        };
        const result = await callGeminiAPI(payload);
        const data = JSON.parse(result.candidates[0].content.parts[0].text);

        // Isi semua kolom dengan data dari AI
        transInput.value = data.translation;
        defEnInput.value = data.definition_en;
        defIdInput.value = data.definition_id;
        exInput.value = data.example;

    } catch (error) {
        console.error("Failed to generate flashcard content:", error);
        showToast("Gagal mengambil data dari AI.", "error");
        transInput.placeholder = "Gagal memuat. Silakan isi manual.";
        defEnInput.placeholder = "Gagal memuat. Silakan isi manual.";
        defIdInput.placeholder = "Gagal memuat. Silakan isi manual.";
        exInput.placeholder = "Gagal memuat. Silakan isi manual.";
    }

    const onSave = async () => {
        // Gabungkan definisi EN dan ID untuk disimpan agar kompatibel dengan tampilan flashcard yang ada
        const combinedDefinition = `${defEnInput.value.trim()}\n(Artinya: ${defIdInput.value.trim()})`;

        const newCard = {
            id: `card_${Date.now()}`,
            word: wordInput.value.trim(),
            translation: transInput.value.trim(), // <-- TAMBAHKAN BARIS INI
            definition: combinedDefinition,
            example: exInput.value.trim()
        };

        if (!newCard.word || !defEnInput.value.trim() || !newCard.example) {
            showToast("Harap isi semua kolom.", "error");
            return;
        }

        flashcards.push(newCard);
        localStorage.setItem('flashcards', JSON.stringify(flashcards));
        await scheduleReview(newCard.id, 'flashcard');
        addXP(5);
        updateUserStat('flashcardsCreated');
        showToast("Flashcard berhasil disimpan!", 'success');
        modal.classList.add('hidden');
        cleanupListeners();
    };

    const onCancel = () => {
        modal.classList.add('hidden');
        cleanupListeners();
    };

    const cleanupListeners = () => {
        saveBtn.removeEventListener('click', onSave);
        cancelBtn.removeEventListener('click', onCancel);
    };

    saveBtn.addEventListener('click', onSave);
    cancelBtn.addEventListener('click', onCancel);
};

document.getElementById('addFlashcardSelectionBtn').addEventListener('click', (e) => {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
        showAddFlashcardModal(selectedText);
    }
    e.currentTarget.classList.add('hidden');
    document.getElementById('translateSelectionBtn').classList.add('hidden');
});


// --- SPEAKING & LISTENING FEATURES ---

function startBookSummary() {
    const bookSummarySection = document.getElementById('bookSummarySection');
    bookSummarySection.innerHTML = createSectionHeader('Rangkuman Buku Non-Fiksi');
    const contentDiv = document.createElement('div');
    bookSummarySection.appendChild(contentDiv);

    const renderGenreSelection = () => {
        const genres = ["Motivation", "Science", "Technology", "Habit", "Productivity", "Biography"];
        contentDiv.innerHTML = `
                    <p class="text-slate-600 mb-2">Pilih genre untuk mendapatkan rangkuman buku populer dalam bahasa Inggris.</p>
                    <p class="text-sm text-slate-500 mb-6 bg-slate-100 p-3 rounded-lg"><i class="fas fa-info-circle mr-2"></i><b>Tips:</b> Klik pada satu kata untuk terjemahan cepat, atau sorot beberapa kata lalu klik tombol <i class="fas fa-language"></i> untuk menerjemahkan kalimat.</p>
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
                        ${genres.map(genre => `<button class="genre-btn bg-slate-100 hover:bg-blue-100 p-4 rounded-lg" data-genre="${genre}">${genre}</button>`).join('')}
                    </div>
                    <div id="summaryContainer" class="mt-8"></div>
                `;
        contentDiv.querySelectorAll('.genre-btn').forEach(btn => {
            btn.addEventListener('click', (e) => generateBookSummary(e.target.dataset.genre, contentDiv.querySelector('#summaryContainer')));
        });
    }

    renderGenreSelection();
    showSection('bookSummarySection');
}

async function generateBookSummary(genre, container) {
    showLoading(true);
    container.innerHTML = '';
    try {
        const readBooks = JSON.parse(localStorage.getItem('readBooks')) || [];
        const exclusionList = readBooks.length > 0 ? `Please avoid summarizing the following books if possible: ${readBooks.join(', ')}.` : '';
        const payload = {
            contents: [{ parts: [{ text: `Act as a book summarizer. Provide a detailed summary of a popular non-fiction book in English from the genre '${genre}'. ${exclusionList} The summary should be concise, well-structured, and capture the main ideas. Format the output as a single JSON object with the keys: 'title' (string), 'author' (string), and 'summary' (an array of strings, where each string is a paragraph).` }] }],
            generationConfig: { responseMimeType: "application/json" }
        };
        const result = await callGeminiAPI(payload);
        const summaryData = JSON.parse(result.candidates[0].content.parts[0].text);
        displayBookSummary(summaryData, genre, container);
    } catch (error) {
        console.error("Error generating book summary:", error);
        showToast("Gagal membuat rangkuman buku.", 'error');
        startBookSummary(); // Go back to genre selection
    } finally {
        showLoading(false);
    }
}

function displayBookSummary(data, genre, container) {
    const readBooks = JSON.parse(localStorage.getItem('readBooks')) || [];
    const isRead = readBooks.includes(data.title);

    const interactiveSummary = data.summary.map(p => {
        const words = p.split(/(\s+)/); // Split by space, keeping spaces
        const interactiveText = words.map(word => {
            if (word.trim().length > 0) {
                return `<span class="translatable-word cursor-pointer hover:bg-yellow-200 rounded">${word}</span>`;
            }
            return word; // Keep spaces as is
        }).join('');
        return `<p>${interactiveText}</p>`;
    }).join('');

    container.innerHTML = `
                <div class="prose max-w-none">
                     <div class="flex items-start justify-between">
                        <div>
                            <h3 class="text-2xl font-bold">${data.title}</h3>
                            <p class="text-slate-500 italic mt-1">by ${data.author}</p>
                        </div>
                        <button id="playSummaryAudioBtn" class="p-2 w-10 h-10 rounded-full hover:bg-slate-200 flex items-center justify-center flex-shrink-0 ml-4" title="Dengarkan Rangkuman">
                            <i class="fas fa-volume-up text-slate-500"></i>
                        </button>
                    </div>
                    <div id="summaryTextContainer" class="mt-4 space-y-4 text-slate-700">
                        ${interactiveSummary}
                    </div>
                </div>
                <div class="flex flex-col sm:flex-row gap-4 mt-8 border-t pt-6">
                    <button id="markAsReadBtn" class="btn-secondary flex-1 ${isRead ? 'opacity-50 cursor-not-allowed' : ''}" ${isRead ? 'disabled' : ''}>
                        ${isRead ? '<i class="fas fa-check mr-2"></i> Sudah Dibaca' : 'Tandai Sudah Dibaca'}
                    </button>
                    <button id="anotherSummaryBtn" class="btn-primary flex-1">Rangkuman Lain (${genre})</button>
                    <button id="changeGenreBtn" class="btn-secondary flex-1">Pilih Genre Lain</button>
                </div>
            `;

    if (!isRead) {
        document.getElementById('markAsReadBtn').addEventListener('click', (e) => {
            const btn = e.currentTarget;
            readBooks.push(data.title);
            localStorage.setItem('readBooks', JSON.stringify(readBooks));
            showToast(`"${data.title}" ditandai sudah dibaca.`);
            addXP(20);
            updateUserStat('booksRead');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-check mr-2"></i> Sudah Dibaca';
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        });
    }

    document.getElementById('playSummaryAudioBtn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const icon = btn.querySelector('i');

        btn.disabled = true;
        icon.classList.replace('fa-volume-up', 'fa-spinner');
        icon.classList.add('fa-spin');

        // Fungsi untuk mereset tombol setelah audio selesai
        const resetBtn = (audio) => {
            if (audio) {
                audio.onended = () => {
                    icon.classList.replace('fa-spinner', 'fa-volume-up');
                    icon.classList.remove('fa-spin');
                    btn.disabled = false;
                };
            } else { // Jika ada error
                icon.classList.replace('fa-spinner', 'fa-volume-up');
                icon.classList.remove('fa-spin');
                btn.disabled = false;
            }
        };

        // --- LOGIKA CACHE BARU ---
        // Cek apakah audio untuk judul ini sudah ada di cache
        if (cachedSummaryAudio.title === data.title && cachedSummaryAudio.data) {
            console.log("Memutar audio dari cache...");
            try {
                const audio = await playAudio(cachedSummaryAudio.data, cachedSummaryAudio.mimeType);
                resetBtn(audio);
            } catch (error) {
                resetBtn(null);
            }
            return; // Hentikan eksekusi di sini
        }
        // --- AKHIR LOGIKA CACHE ---

        // Jika tidak ada di cache, buat audio baru (logika lama)
        console.log("Membuat audio baru dari API...");
        try {
            const summaryText = data.summary.join(' ');
            const payload = {
                contents: [{ parts: [{ text: summaryText }] }],
                generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } } },
            };
            const result = await callGeminiAPI(payload, 'gemini-2.5-flash-preview-tts');
            const part = result?.candidates?.[0]?.content?.parts?.[0];

            if (part?.inlineData?.data) {
                // Simpan audio baru ke cache
                cachedSummaryAudio = {
                    title: data.title,
                    data: part.inlineData.data,
                    mimeType: part.inlineData.mimeType
                };
                const audio = await playAudio(part.inlineData.data, part.inlineData.mimeType);
                resetBtn(audio);
            } else {
                throw new Error("No audio data in response.");
            }
        } catch (error) {
            console.error("Error generating summary audio:", error);
            showToast("Gagal membuat audio.", "error");
            resetBtn(null);
        }
    });

    document.getElementById('anotherSummaryBtn').addEventListener('click', () => generateBookSummary(genre, container));
    document.getElementById('changeGenreBtn').addEventListener('click', startBookSummary);
}

async function startListeningPractice() {
    sessionStorage.setItem('currentRunningActivityId', 'startListeningBtn');
    showLoading(true, "Mempersiapkan sesi listening...");
    const listeningSection = document.getElementById('listeningSection');
    listeningSection.innerHTML = createSectionHeader('Latihan Listening');
    const contentDiv = document.createElement('div');
    listeningSection.appendChild(contentDiv);

    try {
        // --- PENGEMBANGAN: Topik Acak & Jumlah Soal ---
        const topics = [
            'making plans for a holiday', 'ordering food at a cafe',
            'talking about a new movie', 'booking a flight ticket',
            'discussing a hobby', 'at the supermarket',
            'asking for directions', 'talking about the weather',
            'planning a surprise party', 'complaining about traffic'
        ];
        const randomTopic = topics[Math.floor(Math.random() * topics.length)];

        const payload = {
            contents: [{
                parts: [{
                    text: `Generate a listening exercise about "${randomTopic}". The output must be a single JSON object with two keys: "conversation" and "questions". 
            
            1. The "conversation" key must be an array of objects, each with a "speaker" ('Man' or 'Woman') and "line". The conversation should be 4-6 lines long.
            2. The "questions" key must be an array of 5 multiple-choice question objects. Each question object must have "question", "options" (an array of 4 strings), "answer" (the full text of the correct option), and "explanation" in Indonesian.` }]
            }],
            generationConfig: { responseMimeType: "application/json" }
        };
        // --- AKHIR PENGEMBANGAN ---

        const result = await callGeminiAPI(payload);
        const exercise = JSON.parse(result.candidates[0].content.parts[0].text);

        // --- Blok perbaikan format jawaban (dari kode Anda, tetap dipertahankan) ---
        exercise.questions.forEach(q => {
            const correctIndex = q.options.findIndex(option => option === q.answer);
            if (correctIndex !== -1) {
                q.answer = String.fromCharCode(65 + correctIndex); // index 0 -> 'A', 1 -> 'B', dst.
            }
        });
        // --- Akhir blok perbaikan ---

        displayListeningExercise(exercise, contentDiv);
        showSection('listeningSection');

    } catch (error) {
        console.error("Error generating listening exercise:", error);
        showToast("Gagal memuat latihan listening.", 'error');
        showSection(null);
    } finally {
        showLoading(false);
    }
}

function displayListeningExercise(exercise, container) {
    container.innerHTML = `
                <div class="text-center">
                    <p class="text-slate-600 mb-4">Anda akan mendengar percakapan singkat. Audio hanya bisa diputar satu kali. Dengarkan baik-baik, lalu jawab pertanyaan yang muncul setelahnya.</p>
                    <button id="playAudioBtn" class="btn-primary"><i class="fas fa-play mr-2"></i>Mulai & Putar Audio</button>
                    <div id="audioStatus" class="mt-4 text-slate-500"></div>
                    <div id="listeningQuestionsContainer" class="hidden mt-6 text-left"></div>
                </div>
            `;

    document.getElementById('playAudioBtn').addEventListener('click', async (e) => {
        const playBtn = e.currentTarget;
        const audioStatus = document.getElementById('audioStatus');
        const questionsContainer = document.getElementById('listeningQuestionsContainer');

        playBtn.disabled = true;
        playBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Membuat Audio...`;

        try {
            // 1. Construct TTS prompt from structured conversation
            const ttsPrompt = "TTS the following conversation:\n" + exercise.conversation.map(line => `${line.speaker}: ${line.line}`).join('\n');
            const ttsPayload = {
                contents: [{ parts: [{ text: ttsPrompt }] }],
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        multiSpeakerVoiceConfig: {
                            speakerVoiceConfigs: [
                                { speaker: "Man", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
                                { speaker: "Woman", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }
                            ]
                        }
                    }
                },
            };

            // 2. Generate and play audio
            const result = await callGeminiAPI(ttsPayload, 'gemini-2.5-flash-preview-tts');
            const part = result?.candidates?.[0]?.content?.parts?.[0];
            if (!part?.inlineData?.data) throw new Error("No audio data in response.");
            lastListeningAudio = { data: part.inlineData.data, mimeType: part.inlineData.mimeType };

            audioStatus.textContent = "Audio sedang diputar...";
            playBtn.classList.add('hidden');
            const audio = await playAudio(part.inlineData.data, part.inlineData.mimeType);

            // 3. Show questions when audio finishes
            if (audio) {
                audio.onended = () => {
                    audioStatus.classList.add('hidden');
                    questionsContainer.classList.remove('hidden');
                    renderListeningQuestions(exercise.questions, questionsContainer);
                };
            } else {
                throw new Error("Gagal memutar audio.")
            }

        } catch (error) {
            console.error("Error during listening playback:", error);
            showToast("Gagal memutar audio.", 'error');
            playBtn.disabled = false;
            playBtn.innerHTML = `<i class="fas fa-play mr-2"></i>Mulai & Putar Audio`;
        }
    });
}

function renderListeningQuestions(questions, container) {
    let questionsHtml = '<form id="listeningForm">';
    questions.forEach((q, index) => {
        questionsHtml += `<div class="mb-6"><p class="font-semibold mb-3">${index + 1}. ${q.question}</p><div class="space-y-2">`
            + q.options.map((opt, i) => {
                const letter = String.fromCharCode(65 + i);
                return `<label class="flex items-center p-3 border rounded-lg hover:bg-slate-50"><input type="radio" name="q${index}" value="${letter}" class="mr-3"><span>${letter}. ${opt}</span></label>`
            }).join('') + `</div></div>`;
    });
    questionsHtml += '<button type="submit" class="btn-primary w-full">Selesai</button></form>';
    container.innerHTML = questionsHtml;

    document.getElementById('listeningForm').addEventListener('submit', (e) => {
        e.preventDefault();
        let score = 0;
        let userAnswers = {};

        questions.forEach((q, index) => {
            const selected = document.querySelector(`input[name="q${index}"]:checked`);
            if (selected) {
                userAnswers[index] = selected.value;
                if (selected.value === q.answer) {
                    score++;
                }
            } else {
                userAnswers[index] = null; // No answer
            }
        });

        finishListeningPractice(questions, userAnswers, score);
    });
}

function finishListeningPractice(questions, userAnswers, score, originalExercise) {
    addXP(30);
    updateUserStat('listeningSessions');
    const container = document.getElementById('listeningSection');
    let resultsHtml = '<div><h3 class="text-xl font-bold mb-4">Ulasan Jawaban</h3>';

    questions.forEach((q, index) => {
        const userAnswer = userAnswers[index];
        const isCorrect = userAnswer === q.answer;
        resultsHtml += `<div class="mb-4 p-4 rounded-lg border-l-4 ${isCorrect ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}">
            <p class="font-semibold">${index + 1}. ${q.question}</p>
            <p class="text-sm mt-2">Jawaban Anda: <span class="font-bold ${isCorrect ? 'text-green-700' : 'text-red-700'}">${userAnswer ? `${userAnswer}. ${q.options[userAnswer.charCodeAt(0) - 65]}` : 'Tidak dijawab'}</span></p>
            ${!isCorrect ? `<p class="text-sm">Jawaban Benar: <span class="font-bold text-green-700">${q.answer}. ${q.options[q.answer.charCodeAt(0) - 65]}</span></p>` : ''}
            <div class="mt-3 pt-3 border-t border-slate-200"><p class="text-sm font-semibold text-slate-600">Penjelasan:</p><p class="text-sm text-slate-500 italic">${q.explanation}</p></div>
        </div>`;
    });
    resultsHtml += '</div>';

    // HTML baru yang berisi tombol "Putar Ulang" dan "Laporkan"
    const scoreSummaryHtml = `<div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-8">
        <h2 class="text-2xl font-bold text-center mb-4">Hasil Latihan Listening</h2>
        <div class="flex justify-around text-center">
            <div><p class="text-slate-500 text-sm">Benar</p><p class="font-bold text-2xl text-green-600">${score}</p></div>
            <div><p class="text-slate-500 text-sm">Salah</p><p class="font-bold text-2xl text-red-600">${questions.length - score}</p></div>
            <div><p class="text-slate-500 text-sm">Total Soal</p><p class="font-bold text-2xl">${questions.length}</p></div>
        </div>
        <div class="text-center mt-6 border-t pt-4 flex flex-col sm:flex-row gap-3 justify-center">
            <button id="replayListeningAudioBtn" class="btn-secondary !py-2 !px-4"><i class="fas fa-redo-alt mr-2"></i> Putar Ulang Audio</button>
        </div>
    </div>`;

    container.innerHTML = createSectionHeader('Latihan Listening') + scoreSummaryHtml + resultsHtml;

    // --- Logika untuk Tombol-Tombol Baru ---
    const replayBtn = document.getElementById('replayListeningAudioBtn');
    if (replayBtn) {
        replayBtn.addEventListener('click', async () => {
            if (!lastListeningAudio) { showToast("Data audio tidak ditemukan.", "error"); return; }
            replayBtn.disabled = true;
            replayBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Memutar...';
            try {
                const audio = await playAudio(lastListeningAudio.data, lastListeningAudio.mimeType);
                if (audio) {
                    audio.onended = () => {
                        replayBtn.disabled = false;
                        replayBtn.innerHTML = '<i class="fas fa-redo-alt mr-2"></i> Putar Ulang Audio';
                    };
                }
            } catch (error) {
                replayBtn.disabled = false;
                replayBtn.innerHTML = '<i class="fas fa-redo-alt mr-2"></i> Putar Ulang Audio';
            }
        });
    }
    handleEndOfActivity();
}

function startSpeakingHelper() {
    sessionStorage.setItem('currentRunningActivityId', 'startSpeakingBtn');
    const speakingSection = document.getElementById('speakingSection');
    speakingSection.innerHTML = createSectionHeader('Asisten Dialog');
    const contentDiv = document.createElement('div');
    speakingSection.appendChild(contentDiv);
    const initialHtml = `
                <div>
                    <p class="text-slate-600 mb-4">Masukkan topik dialog yang Anda inginkan, atau pilih salah satu dari opsi di bawah.</p>
                    <div class="flex space-x-2 mb-6">
                        <input type="text" id="customTopicInput" class="block w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" placeholder="Contoh: Talking about a holiday trip">
                        <button id="generateCustomTopicBtn" class="btn-primary whitespace-nowrap">Buat Dialog</button>
                    </div>
                    <div class="text-center mb-4"><div class="inline-block w-full h-px bg-slate-200"></div></div>
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-center">
                        <button class="topic-btn bg-slate-100 hover:bg-blue-100 p-4 rounded-lg" data-topic="Ordering food">Pesan Makanan</button>
                        <button class="topic-btn bg-slate-100 hover:bg-blue-100 p-4 rounded-lg" data-topic="Introducing yourself">Perkenalan</button>
                        <button class="topic-btn bg-slate-100 hover:bg-blue-100 p-4 rounded-lg" data-topic="Asking for directions">Tanya Arah</button>
                    </div>
                    <div id="dialogueContainer" class="mt-8 text-left"></div>
                </div>`;
    contentDiv.innerHTML = initialHtml;

    const dialogueContainer = contentDiv.querySelector('#dialogueContainer');

    contentDiv.querySelectorAll('.topic-btn').forEach(btn => {
        btn.addEventListener('click', (e) => generateDialogue(e.target.dataset.topic, dialogueContainer));
    });

    contentDiv.querySelector('#generateCustomTopicBtn').addEventListener('click', () => {
        const customTopicInput = contentDiv.querySelector('#customTopicInput');
        const topic = customTopicInput.value.trim();
        if (!topic) {
            showToast('Silakan masukkan topik dialog.', 'error');
            return;
        }
        generateDialogue(topic, dialogueContainer);
    });

    showSection('speakingSection');
}

async function generateDialogue(topic, container) {
    showLoading(true);
    container.innerHTML = '';
    try {
        const payload = {
            contents: [{ parts: [{ text: `Generate an English dialogue with a minimum of 6 lines about "${topic}" between Speaker A and Speaker B. Format as a JSON array of objects with "speaker" and "line" keys.` }] }],
            generationConfig: { responseMimeType: "application/json" }
        };
        const result = await callGeminiAPI(payload);
        const dialogue = JSON.parse(result.candidates[0].content.parts[0].text);
        displayDialogue(dialogue, topic, container);
    } catch (error) {
        console.error("Error generating dialogue:", error);
        showToast("Gagal membuat dialog.", 'error');
    } finally {
        showLoading(false);
    }
}

function displayDialogue(dialogue, topic, container) {
    let dialogueHtml = `<h4 class="font-bold text-lg mb-4 border-b pb-2">Skenario: ${topic}</h4>`;
    dialogue.forEach((item) => {
        const isSpeakerA = item.speaker === 'A' || item.speaker === 'Speaker A';
        const speakerLabel = isSpeakerA ? 'Speaker A' : 'Speaker B';
        dialogueHtml += `<div class="flex items-start space-x-3 mb-3"><div class="flex-shrink-0 font-bold ${isSpeakerA ? 'text-blue-600' : 'text-green-600'} w-24">${speakerLabel}:</div><div class="flex-grow p-3 rounded-lg ${isSpeakerA ? 'bg-blue-50' : 'bg-green-50'}"><p>${item.line}</p></div><button class="play-speech-btn p-2 w-10 h-10 rounded-full hover:bg-slate-200 flex items-center justify-center" data-text="${encodeURIComponent(item.line)}" data-speaker="${item.speaker}"><i class="fas fa-volume-up text-slate-500"></i></button></div>`;
    });
    container.innerHTML = dialogueHtml;
    container.querySelectorAll('.play-speech-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const button = e.currentTarget;
            const text = decodeURIComponent(button.dataset.text);
            const speaker = button.dataset.speaker;
            const icon = button.querySelector('i');
            icon.classList.replace('fa-volume-up', 'fa-spinner');
            icon.classList.add('fa-spin');
            button.disabled = true;
            try {
                const payload = {
                    contents: [{ parts: [{ text }] }],
                    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: (speaker === 'A' || speaker === 'Speaker A') ? 'Kore' : 'Puck' } } } },
                };
                const result = await callGeminiAPI(payload, 'gemini-2.5-flash-preview-tts');
                const part = result?.candidates?.[0]?.content?.parts?.[0];
                if (part?.inlineData?.data) await playAudio(part.inlineData.data, part.inlineData.mimeType);
                else throw new Error("No audio data in response.");
            } catch (error) {
                console.error("Error generating speech:", error);
                showToast("Gagal memutar suara.", 'error');
            } finally {
                icon.classList.replace('fa-spinner', 'fa-volume-up');
                icon.classList.remove('fa-spin');
                button.disabled = false;
            }
        });
    });
}

// --- SETTINGS FEATURE ---

function manageSettings() {
    const settingsSection = document.getElementById('settingsSection');
    settingsSection.innerHTML = createSectionHeader('Pengaturan');
    const contentDiv = document.createElement('div');
    settingsSection.appendChild(contentDiv);

    const savedApiKey = localStorage.getItem('geminiApiKey') || '';

    contentDiv.innerHTML = `
                <div class="space-y-6">
                    <div>
                        <label for="apiKeyInput" class="block text-sm font-medium text-slate-700">Kunci API Gemini Anda</label>
                        <input type="password" id="apiKeyInput" value="${savedApiKey}" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm" placeholder="Masukkan Kunci API Anda di sini...">
                        <p class="mt-2 text-xs text-slate-500">Kunci API Anda disimpan dengan aman di browser Anda dan tidak akan dibagikan.</p>
                    </div>
                    <button id="saveApiKeyBtn" class="btn-primary">Simpan Kunci API</button>

                    <div class="border-t pt-6">
                        <h4 class="text-lg font-bold mb-3">Cara Mendapatkan Kunci API Gemini</h4>
                        <div class="space-y-4 text-sm text-slate-600">
                            <p>Anda memerlukan Kunci API dari Google AI Studio agar aplikasi ini dapat berfungsi. Prosesnya gratis dan cepat.</p>
                            <ol class="list-decimal list-inside space-y-2">
                                <li>Buka <a href="https://aistudio.google.com/app/apikey" target="_blank" class="text-blue-600 font-semibold hover:underline">Google AI Studio</a> dan login dengan akun Google Anda.</li>
                                <li>Klik tombol <b class="text-slate-800">"Create API key"</b>.</li>
                                <li>Klik <b class="text-slate-800">Select a Cloud Project</b>. Lalu, buat project beserta isi nama project Anda.</li>
                                <li>Pilih nama project yang telah dibuat dan isi nama kunci API Anda.</li>
                                <li>Sebuah Kunci API baru akan dibuat. Klik ikon salin di sebelahnya untuk menyalin kunci tersebut.</li>
                                <li>Tempel (paste) kunci yang sudah Anda salin ke dalam kolom di atas dan klik "Simpan".</li>
                            </ol>
                            </hr>
                            <span>- Daffa Aulia Rahman</span>
                        </div>
                    </div>
                </div>
            `;

    document.getElementById('saveApiKeyBtn').addEventListener('click', () => {
        const newApiKey = document.getElementById('apiKeyInput').value.trim();
        if (newApiKey) {
            localStorage.setItem('geminiApiKey', newApiKey);
            apiKey = newApiKey; // Update the global variable
            showToast("Kunci API berhasil disimpan!");
            showSection(null); // Go back to dashboard
        } else {
            localStorage.removeItem('geminiApiKey');
            apiKey = "";
            showToast("Kunci API dihapus.", "success");
        }
    });

    showSection('settingsSection');
}


// --- GRAMMAR GUIDE FEATURE ---

const GRAMMAR_TOPICS = [{
    key: 'simple_present',
    title: 'Simple Present Tense',
    category: 'Tenses',
    level: 'Beginner',
    explanation: `
              <h4 class="text-xl font-bold mb-3">Simple Present Tense</h4>
              <p class="mb-4">Digunakan untuk menyatakan fakta, kebiasaan, atau kejadian yang terjadi berulang kali saat ini.</p>
              <div class="space-y-3">
                  <div>
                      <h5 class="font-semibold text-slate-700">Fungsi & Rumus</h5>
                      <ul class="list-disc list-inside text-sm text-slate-600 space-y-1 mt-2">
                          <li><b>Fakta Umum:</b> The sun <span class="text-blue-600 font-semibold">rises</span> in the east.</li>
                          <li><b>Kebiasaan:</b> She <span class="text-blue-600 font-semibold">drinks</span> coffee every morning.</li>
                          <li><b>Rumus (+):</b> Subject + V1 (s/es) + Object</li>
                          <li><b>Rumus (-):</b> Subject + do/does + not + V1 + Object</li>
                          <li><b>Rumus (?):</b> Do/Does + Subject + V1 + Object?</li>
                      </ul>
                  </div>
                  <div>
                      <h5 class="font-semibold text-slate-700">Contoh Kalimat</h5>
                      <div class="text-sm bg-slate-50 p-3 rounded-md mt-2 space-y-1">
                          <p><b class="text-green-600">(+)</b> They <span class="font-semibold">play</span> football on weekends.</p>
                          <p><b class="text-red-600">(-)</b> He <span class="font-semibold">does not like</span> vegetables.</p>
                          <p><b class="text-orange-600">(?)</b> <span class="font-semibold">Do</span> you <span class="font-semibold">speak</span> English?</p>
                      </div>
                  </div>
              </div>
          `
}, {
    key: 'present_continuous',
    title: 'Present Continuous Tense',
    category: 'Tenses',
    level: 'Beginner',
    explanation: `
              <h4 class="text-xl font-bold mb-3">Present Continuous Tense</h4>
              <p class="mb-4">Digunakan untuk membicarakan aksi yang sedang berlangsung pada saat pembicaraan atau sebuah rencana di masa depan.</p>
              <div class="space-y-3">
                  <div>
                      <h5 class="font-semibold text-slate-700">Fungsi & Rumus</h5>
                      <ul class="list-disc list-inside text-sm text-slate-600 space-y-1 mt-2">
                          <li><b>Aksi Sekarang:</b> I <span class="text-blue-600 font-semibold">am studying</span> right now.</li>
                          <li><b>Rencana Pasti:</b> We <span class="text-blue-600 font-semibold">are meeting</span> him tomorrow.</li>
                          <li><b>Rumus (+):</b> Subject + to be (am/is/are) + V-ing + Object</li>
                          <li><b>Rumus (-):</b> Subject + to be + not + V-ing + Object</li>
                          <li><b>Rumus (?):</b> To be + Subject + V-ing + Object?</li>
                      </ul>
                  </div>
                  <div>
                      <h5 class="font-semibold text-slate-700">Contoh Kalimat</h5>
                      <div class="text-sm bg-slate-50 p-3 rounded-md mt-2 space-y-1">
                          <p><b class="text-green-600">(+)</b> The chef <span class="font-semibold">is preparing</span> the meal.</p>
                          <p><b class="text-red-600">(-)</b> They <span class="font-semibold">are not watching</span> TV.</p>
                          <p><b class="text-orange-600">(?)</b> <span class="font-semibold">Is</span> she <span class="font-semibold">working</span> on the project?</p>
                      </div>
                  </div>
              </div>
          `
}, {
    key: 'articles',
    title: 'Articles (A, An, The)',
    category: 'Parts of Speech',
    level: 'Beginner',
    explanation: `
              <h4 class="text-xl font-bold mb-3">Articles: A, An, The</h4>
              <p class="mb-4">Articles adalah kata yang digunakan sebelum noun (kata benda) untuk menunjukkan apakah kata benda tersebut spesifik atau tidak.</p>
              <div class="space-y-3">
                  <div>
                      <h5 class="font-semibold text-slate-700">Indefinite Articles (A, An)</h5>
                      <ul class="list-disc list-inside text-sm text-slate-600 space-y-1 mt-2">
                          <li>Digunakan untuk benda yang tidak spesifik atau disebutkan pertama kali.</li>
                          <li><b>A:</b> untuk kata benda yang diawali bunyi konsonan. Contoh: I see <span class="text-blue-600 font-semibold">a</span> car.</li>
                          <li><b>An:</b> untuk kata benda yang diawali bunyi vokal. Contoh: She wants <span class="text-blue-600 font-semibold">an</span> apple.</li>
                      </ul>
                  </div>
                  <div>
                      <h5 class="font-semibold text-slate-700">Definite Article (The)</h5>
                      <ul class="list-disc list-inside text-sm text-slate-600 space-y-1 mt-2">
                          <li>Digunakan untuk benda yang spesifik atau sudah disebutkan sebelumnya.</li>
                           <li>Contoh: <span class="text-blue-600 font-semibold">The</span> car is red. (Mobil spesifik yang kita bicarakan).</li>
                           <li>Contoh: <span class="text-blue-600 font-semibold">The</span> sun is very bright. (Benda yang hanya ada satu).</li>
                      </ul>
                  </div>
              </div>
          `
}, {
    key: 'simple_past',
    title: 'Simple Past Tense',
    category: 'Tenses',
    level: 'Beginner',
    explanation: `
            <h4 class="text-xl font-bold mb-3">Simple Past Tense</h4>
            <p class="mb-4">Digunakan untuk menyatakan kejadian yang dimulai dan selesai pada waktu tertentu di masa lampau.</p>
            <h5 class="font-semibold text-slate-700">Rumus & Contoh</h5>
            <ul class="list-disc list-inside text-sm text-slate-600 space-y-1 mt-2">
                <li><b>Rumus (+):</b> Subject + V2 + Object</li>
                <li><b>Rumus (-):</b> Subject + did + not + V1 + Object</li>
                <li><b>Rumus (?):</b> Did + Subject + V1 + Object?</li>
                <li><b>Contoh:</b> They <span class="text-blue-600 font-semibold">watched</span> a movie last night.</li>
                <li><b>Contoh:</b> She <span class="text-blue-600 font-semibold">did not attend</span> the meeting.</li>
            </ul>
        `
}, // <-- Pastikan ada koma setelah materi terakhir Anda

{
    key: 'present_perfect',
    title: 'Present Perfect Tense',
    category: 'Tenses',
    level: 'Intermediate',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Present Perfect Tense</h2>
        <p class="mb-6 text-slate-600">Digunakan untuk aksi di masa lalu yang masih ada hubungannya dengan masa kini.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Fungsi & Rumus</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Pengalaman Hidup:</b> She <strong>has visited</strong> Paris.</li>
            <li><b>Aksi Lampau dengan Hasil Sekarang:</b> I <strong>have lost</strong> my keys.</li>
            <li><b>Rumus (+):</b> Subject + have/has + V3 + Object</li>
            <li><b>Rumus (-):</b> Subject + have/has + not + V3 + Object</li>
            <li><b>Rumus (?):</b> Have/Has + Subject + V3 + Object?</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p><b class="text-green-600">(+)</b> They <strong>have finished</strong> the project.</p>
            <p><b class="text-red-600">(-)</b> He <strong>has not eaten</strong> lunch yet.</p>
            <p><b class="text-orange-600">(?)</b> <strong>Have</strong> you <strong>ever been</strong> to London?</p>
        </div>
    `
},
{
    key: 'present_perfect_continuous',
    title: 'Present Perfect Continuous',
    category: 'Tenses',
    level: 'Advanced',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Present Perfect Continuous</h2>
        <p class="mb-6 text-slate-600">Menekankan durasi sebuah aksi yang dimulai di masa lalu dan masih berlangsung hingga kini.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Fungsi & Rumus</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Fokus pada Durasi:</b> It <strong>has been raining</strong> for hours.</li>
            <li><b>Rumus (+):</b> Subject + have/has + been + V-ing + Object</li>
            <li><b>Rumus (-):</b> Subject + have/has + not + been + V-ing + Object</li>
            <li><b>Rumus (?):</b> Have/Has + Subject + been + V-ing + Object?</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p><b class="text-green-600">(+)</b> She <strong>has been studying</strong> since 8 AM.</p>
            <p><b class="text-red-600">(-)</b> We <strong>have not been watching</strong> TV all day.</p>
            <p><b class="text-orange-600">(?)</b> How long <strong>have</strong> you <strong>been waiting</strong>?</p>
        </div>
    `
},
{
    key: 'past_continuous',
    title: 'Past Continuous Tense',
    category: 'Tenses',
    level: 'Beginner',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Past Continuous Tense</h2>
        <p class="mb-6 text-slate-600">Menjelaskan aksi yang sedang berlangsung pada waktu tertentu di masa lalu, atau diinterupsi oleh aksi lain.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Fungsi & Rumus</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Aksi yang Diinterupsi:</b> I <strong>was studying</strong> when he called.</li>
            <li><b>Aksi di Waktu Spesifik:</b> At 7 PM last night, I <strong>was eating</strong> dinner.</li>
            <li><b>Rumus (+):</b> Subject + was/were + V-ing + Object</li>
            <li><b>Rumus (-):</b> Subject + was/were + not + V-ing + Object</li>
            <li><b>Rumus (?):</b> Was/Were + Subject + V-ing + Object?</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p><b class="text-green-600">(+)</b> They <strong>were playing</strong> football.</p>
            <p><b class="text-red-600">(-)</b> She <strong>was not sleeping</strong> at 11 PM.</p>
            <p><b class="text-orange-600">(?)</b> <strong>Were</strong> you <strong>working</strong> yesterday?</p>
        </div>
    `
},
{
    key: 'past_perfect',
    title: 'Past Perfect Tense',
    category: 'Tenses',
    level: 'Intermediate',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Past Perfect Tense</h2>
        <p class="mb-6 text-slate-600">Menjelaskan aksi yang sudah selesai sebelum aksi lain terjadi di masa lalu.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Fungsi & Rumus</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Urutan Kejadian:</b> The train <strong>had left</strong> before I arrived.</li>
            <li><b>Rumus (+):</b> Subject + had + V3 + Object</li>
            <li><b>Rumus (-):</b> Subject + had + not + V3 + Object</li>
            <li><b>Rumus (?):</b> Had + Subject + V3 + Object?</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p><b class="text-green-600">(+)</b> He <strong>had finished</strong> his work by 5 PM.</p>
            <p><b class="text-red-600">(-)</b> She <strong>had not seen</strong> the movie before.</p>
            <p><b class="text-orange-600">(?)</b> <strong>Had</strong> they <strong>eaten</strong> when you came?</p>
        </div>
    `
},
{
    key: 'future_simple',
    title: 'Simple Future Tense',
    category: 'Tenses',
    level: 'Beginner',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Simple Future Tense</h2>
        <p class="mb-6 text-slate-600">Menjelaskan aksi atau keadaan di masa depan.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Fungsi & Rumus (Will vs. Going To)</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>'Will' (Keputusan Spontan/Prediksi):</b> I think it <strong>will rain</strong> tomorrow.</li>
            <li><b>'Going to' (Rencana Pasti):</b> I <strong>am going to visit</strong> my parents next week.</li>
            <li><b>Rumus (Will):</b> Subject + will + V1 + Object</li>
            <li><b>Rumus (Going to):</b> Subject + to be (am/is/are) + going to + V1 + Object</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p><b class="text-green-600">(+)</b> She <strong>will help</strong> you.</p>
            <p><b class="text-red-600">(-)</b> We <strong>are not going to</strong> be late.</p>
            <p><b class="text-orange-600">(?)</b> <strong>Will</strong> they <strong>come</strong> to the party?</p>
        </div>
    `
},
{
    key: 'future_perfect',
    title: 'Future Perfect Tense',
    category: 'Tenses',
    level: 'Advanced',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Future Perfect Tense</h2>
        <p class="mb-6 text-slate-600">Menjelaskan aksi yang akan sudah selesai sebelum waktu tertentu di masa depan.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Fungsi & Rumus</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Aksi Selesai di Masa Depan:</b> By next year, I <strong>will have graduated</strong>.</li>
            <li><b>Rumus (+):</b> Subject + will have + V3 + Object</li>
            <li><b>Rumus (-):</b> Subject + will not have + V3 + Object</li>
            <li><b>Rumus (?):</b> Will + Subject + have + V3 + Object?</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p><b class="text-green-600">(+)</b> By 10 PM, she <strong>will have finished</strong> her report.</p>
            <p><b class="text-red-600">(-)</b> They <strong>will not have arrived</strong> by then.</p>
            <p><b class="text-orange-600">(?)</b> <strong>Will</strong> you <strong>have eaten</strong> before we meet?</p>
        </div>
    `
}, // <-- Pastikan ada koma setelah materi terakhir Anda

{
    key: 'past_perfect_continuous',
    title: 'Past Perfect Continuous',
    category: 'Tenses',
    level: 'Advanced',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Past Perfect Continuous</h2>
        <p class="mb-6 text-slate-600">Menjelaskan durasi sebuah aksi yang sedang berlangsung sebelum aksi lain terjadi di masa lalu.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Fungsi & Rumus</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Fokus pada Durasi di Masa Lalu:</b> Menunjukkan berapa lama sesuatu terjadi sebelum titik waktu lampau lainnya.</li>
            <li><b>Rumus (+):</b> Subject + had + been + V-ing + Object</li>
            <li><b>Rumus (-):</b> Subject + had + not + been + V-ing + Object</li>
            <li><b>Rumus (?):</b> Had + Subject + been + V-ing + Object?</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p><b class="text-green-600">(+)</b> He was tired because he <strong>had been working</strong> all day.</p>
            <p><b class="text-red-600">(-)</b> They <strong>had not been waiting</strong> long when the bus arrived.</p>
            <p><b class="text-orange-600">(?)</b> <strong>Had</strong> you <strong>been studying</strong> before the exam started?</p>
        </div>
    `
},
{
    key: 'future_continuous',
    title: 'Future Continuous Tense',
    category: 'Tenses',
    level: 'Intermediate',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Future Continuous Tense</h2>
        <p class="mb-6 text-slate-600">Menjelaskan aksi yang akan sedang berlangsung pada waktu spesifik di masa depan.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Fungsi & Rumus</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Aksi di Masa Depan:</b> Menunjukkan aktivitas yang akan terjadi dan berlangsung selama beberapa waktu.</li>
            <li><b>Rumus (+):</b> Subject + will be + V-ing + Object</li>
            <li><b>Rumus (-):</b> Subject + will not be + V-ing + Object</li>
            <li><b>Rumus (?):</b> Will + Subject + be + V-ing + Object?</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p><b class="text-green-600">(+)</b> This time tomorrow, I <strong>will be flying</strong> to Japan.</p>
            <p><b class="text-red-600">(-)</b> Don't call at 9 PM, I <strong>will not be working</strong>.</p>
            <p><b class="text-orange-600">(?)</b> <strong>Will</strong> you <strong>be using</strong> the car this afternoon?</p>
        </div>
    `
},
{
    key: 'future_perfect_continuous',
    title: 'Future Perfect Continuous',
    category: 'Tenses',
    level: 'Advanced',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Future Perfect Continuous</h2>
        <p class="mb-6 text-slate-600">Menekankan durasi sebuah aksi yang akan telah berlangsung hingga titik waktu tertentu di masa depan.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Fungsi & Rumus</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Durasi Aksi di Masa Depan:</b> Menunjukkan berapa lama sesuatu akan telah terjadi di masa depan.</li>
            <li><b>Rumus (+):</b> Subject + will have been + V-ing + Object</li>
            <li><b>Rumus (-):</b> Subject + will not have been + V-ing + Object</li>
            <li><b>Rumus (?):</b> Will + Subject + have been + V-ing + Object?</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p><b class="text-green-600">(+)</b> By next year, she <strong>will have been teaching</strong> for 20 years.</p>
            <p><b class="text-red-600">(-)</b> In one hour, I <strong>will not have been studying</strong> for long.</p>
            <p><b class="text-orange-600">(?)</b> How long <strong>will</strong> you <strong>have been living</strong> here by the end of this month?</p>
        </div>
    `
}, // <-- Pastikan ada koma setelah materi terakhir Anda

{
    key: 'nouns_countable_uncountable',
    title: 'Nouns: Countable vs Uncountable',
    category: 'Parts of Speech',
    level: 'Beginner',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Nouns: Countable vs Uncountable</h2>
        <p class="mb-6 text-slate-600">Memahami perbedaan antara kata benda yang bisa dihitung dan yang tidak bisa dihitung.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Penjelasan</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Countable Nouns:</b> Benda yang bisa dihitung dan memiliki bentuk jamak (plural). Menggunakan <i>a/an, many, few</i>. Contoh: one <strong>book</strong>, two <strong>books</strong>.</li>
            <li><b>Uncountable Nouns:</b> Benda yang tidak bisa dihitung (cairan, ide, materi abstrak). Tidak memiliki bentuk jamak. Menggunakan <i>much, little</i>. Contoh: <strong>water</strong>, <strong>information</strong>, <strong>rice</strong>.</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p>I have <strong>many</strong> <strong class="text-blue-600">friends</strong>. (Countable)</p>
            <p>How <strong>much</strong> <strong class="text-blue-600">money</strong> do you have? (Uncountable)</p>
            <p>She needs <strong>a little</strong> <strong class="text-blue-600">sugar</strong> for her coffee. (Uncountable)</p>
        </div>
    `
},
{
    key: 'adjectives_adverbs',
    title: 'Adjectives vs. Adverbs',
    category: 'Parts of Speech',
    level: 'Beginner',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Adjectives vs. Adverbs</h2>
        <p class="mb-6 text-slate-600">Membedakan kata yang mendeskripsikan kata benda (Adjective) dan kata yang mendeskripsikan kata kerja (Adverb).</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Perbedaan Kunci</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Adjective (Kata Sifat):</b> Menjelaskan <i>noun</i> (kata benda) atau <i>pronoun</i> (kata ganti). Contoh: a <strong>beautiful</strong> flower.</li>
            <li><b>Adverb (Kata Keterangan):</b> Menjelaskan <i>verb</i> (kata kerja), <i>adjective</i>, atau <i>adverb</i> lain. Seringkali diakhiri dengan '-ly'. Contoh: She sings <strong>beautifully</strong>.</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p>He is a <strong class="text-blue-600">careful</strong> driver. (Adjective menjelaskan 'driver')</p>
            <p>He drives <strong class="text-blue-600">carefully</strong>. (Adverb menjelaskan 'drives')</p>
            <p>The music is <strong class="text-blue-600">extremely loud</strong>. (Adverb 'extremely' menjelaskan adjective 'loud')</p>
        </div>
    `
},
{
    key: 'pronouns_types',
    title: 'Pronouns (Kata Ganti)',
    category: 'Parts of Speech',
    level: 'Beginner',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Pronouns (Kata Ganti)</h2>
        <p class="mb-6 text-slate-600">Kata yang digunakan untuk menggantikan kata benda (noun) untuk menghindari pengulangan.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Jenis-jenis Umum</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Subject Pronouns (Pelaku):</b> I, you, he, she, it, we, they. Contoh: <strong>She</strong> is a doctor.</li>
            <li><b>Object Pronouns (Objek):</b> me, you, him, her, it, us, them. Contoh: He called <strong>me</strong>.</li>
            <li><b>Possessive Pronouns (Kepemilikan):</b> mine, yours, his, hers, its, ours, theirs. Contoh: The book is <strong>mine</strong>.</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p><strong class="text-blue-600">We</strong> gave <strong class="text-blue-600">him</strong> a gift.</p>
            <p>That bag is nice, but this one is <strong class="text-blue-600">yours</strong>.</p>
        </div>
    `
},
{
    key: 'conjunctions',
    title: 'Conjunctions (Kata Sambung)',
    category: 'Parts of Speech',
    level: 'Intermediate',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Conjunctions (Kata Sambung)</h2>
        <p class="mb-6 text-slate-600">Kata yang berfungsi untuk menghubungkan kata, frasa, atau kalimat.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Jenis-jenis Umum</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Coordinating (FANBOYS):</b> For, And, Nor, But, Or, Yet, So. Menghubungkan dua elemen yang setara.</li>
            <li><b>Subordinating:</b> because, although, since, while, if, etc. Menghubungkan klausa independen dengan klausa dependen.</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p>I like coffee, <strong class="text-blue-600">but</strong> she prefers tea.</p>
            <p>He went to bed early <strong class="text-blue-600">because</strong> he was tired.</p>
            <p><strong class="text-blue-600">Although</strong> it was raining, they went for a walk.</p>
        </div>
    `
},
{
    key: 'modal_verbs',
    title: 'Modal Verbs',
    category: 'Parts of Speech',
    level: 'Intermediate',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Modal Verbs</h2>
        <p class="mb-6 text-slate-600">Kata kerja bantu yang memberikan makna tambahan seperti kemampuan, kemungkinan, atau kewajiban.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Contoh & Fungsinya</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Kemampuan (Ability):</b> Can, Could. Contoh: I <strong>can</strong> speak English.</li>
            <li><b>Izin (Permission):</b> May, Can. Contoh: <strong>May</strong> I come in?</li>
            <li><b>Saran (Advice):</b> Should. Contoh: You <strong>should</strong> see a doctor.</li>
            <li><b>Kewajiban (Obligation):</b> Must, Have to. Contoh: I <strong>must</strong> finish this report.</li>
            <li><b>Kemungkinan (Possibility):</b> Might, May, Could. Contoh: It <strong>might</strong> rain later.</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p>She <strong class="text-blue-600">can</strong> play the piano very well.</p>
            <p>You <strong class="text-blue-600">should</strong> wear a jacket. It's cold outside.</p>
        </div>
    `
}, // <-- Pastikan ada koma setelah materi terakhir Anda

{
    key: 'adjectives_comparative_superlative',
    title: 'Adjectives: Comparative & Superlative',
    category: 'Parts of Speech',
    level: 'Beginner',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Adjectives: Comparative & Superlative</h2>
        <p class="mb-6 text-slate-600">Digunakan untuk membandingkan dua hal atau lebih.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Jenis Perbandingan</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-2 mb-6">
            <li>
                <b>Comparative (Membandingkan 2 hal):</b>
                <ul class="list-[circle] list-inside ml-4">
                    <li>Tambah <i>-er</i> untuk kata sifat pendek (contoh: fast<b class="text-blue-600">er</b>).</li>
                    <li>Gunakan <i>more</i> untuk kata sifat panjang (contoh: <b class="text-blue-600">more</b> expensive).</li>
                    <li>Selalu diikuti kata <i>than</i>.</li>
                </ul>
            </li>
            <li>
                <b>Superlative (Membandingkan 3+ hal / "paling"):</b>
                <ul class="list-[circle] list-inside ml-4">
                    <li>Tambah <i>-est</i> untuk kata sifat pendek (contoh: fast<b class="text-blue-600">est</b>).</li>
                    <li>Gunakan <i>most</i> untuk kata sifat panjang (contoh: <b class="text-blue-600">most</b> expensive).</li>
                    <li>Selalu diawali kata <i>the</i>.</li>
                </ul>
            </li>
            <li><b>Irregular (Tidak Beraturan):</b> good → better → the best; bad → worse → the worst.</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p>My car is <strong>faster than</strong> yours. (Comparative)</p>
            <p>This is <strong>the most interesting book</strong> I have ever read. (Superlative)</p>
            <p>Her presentation was <strong>better than</strong> mine. (Irregular)</p>
        </div>
    `
},
{
    key: 'gerunds_infinitives',
    title: 'Gerunds & Infinitives',
    category: 'Parts of Speech',
    level: 'Intermediate',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Gerunds & Infinitives</h2>
        <p class="mb-6 text-slate-600">Bentuk kata kerja (verb) yang berfungsi sebagai kata benda (noun) dalam sebuah kalimat.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Penjelasan</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-2 mb-6">
            <li><b>Gerund (Verb-ing):</b> Digunakan sebagai subjek kalimat, setelah preposisi, atau setelah kata kerja tertentu (seperti <i>enjoy, avoid, finish</i>).</li>
            <li><b>Infinitive (to + Verb):</b> Digunakan untuk menunjukkan tujuan, setelah kata sifat, atau setelah kata kerja tertentu (seperti <i>want, decide, hope</i>).</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p><strong class="text-blue-600">Swimming</strong> is my hobby. (Gerund sebagai subjek)</p>
            <p>She is good at <strong class="text-blue-600">drawing</strong>. (Gerund setelah preposisi 'at')</p>
            <p>He enjoys <strong class="text-blue-600">listening</strong> to music. (Gerund setelah verb 'enjoy')</p>
            <p>I need <strong class="text-blue-600">to study</strong> for the test. (Infinitive setelah verb 'need')</p>
            <p>They came here <strong class="text-blue-600">to learn</strong> English. (Infinitive menunjukkan tujuan)</p>
        </div>
    `
}
    , {
    key: 'prepositions',
    title: 'Prepositions (In, On, At)',
    category: 'Parts of Speech',
    level: 'Beginner',
    explanation: `
            <h4 class="text-xl font-bold mb-3">Prepositions of Time & Place</h4>
            <p class="mb-4">Preposisi seperti <b>in, on, at</b> digunakan untuk menunjukkan hubungan waktu atau lokasi.</p>
            <h5 class="font-semibold text-slate-700">Penggunaan Umum</h5>
            <ul class="list-disc list-inside text-sm text-slate-600 space-y-1 mt-2">
                <li><b>IN:</b> Untuk periode waktu yang panjang (bulan, tahun, abad) atau lokasi yang tertutup/luas (in May, in 2025, in the box, in London).</li>
                <li><b>ON:</b> Untuk hari dan tanggal spesifik atau permukaan (on Sunday, on December 25th, on the table).</li>
                <li><b>AT:</b> Untuk waktu yang sangat spesifik (jam) atau titik/lokasi spesifik (at 9:00 PM, at the bus stop).</li>
            </ul>
        `
}, // <-- Pastikan ada koma setelah materi terakhir Anda

{
    key: 'conditionals',
    title: 'Conditional Sentences (If-Clauses)',
    category: 'Sentence Structure',
    level: 'Intermediate',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Conditional Sentences (If-Clauses)</h2>
        <p class="mb-6 text-slate-600">Kalimat pengandaian yang terdiri dari klausa 'if' (kondisi) dan klausa utama (hasil).</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Tipe-Tipe Utama</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-2 mb-6">
            <li><b>Type 1 (Kemungkinan di Masa Depan):</b> Menyatakan kemungkinan nyata.
                <br><code class="text-sm text-blue-600">If + Simple Present, ... will + Verb 1</code>
            </li>
            <li><b>Type 2 (Pengandaian di Masa Kini):</b> Menyatakan situasi hipotetis/tidak nyata saat ini.
                <br><code class="text-sm text-blue-600">If + Simple Past, ... would + Verb 1</code>
            </li>
            <li><b>Type 3 (Pengandaian di Masa Lalu):</b> Menyatakan penyesalan atau situasi hipotetis di masa lalu.
                <br><code class="text-sm text-blue-600">If + Past Perfect, ... would have + V3</code>
            </li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p><b>(Type 1)</b> If it <strong>rains</strong>, we <strong>will cancel</strong> the trip.</p>
            <p><b>(Type 2)</b> If I <strong>had</strong> a million dollars, I <strong>would buy</strong> a new house.</p>
            <p><b>(Type 3)</b> If I <strong>had studied</strong> harder, I <strong>would have passed</strong> the exam.</p>
        </div>
    `
},
{
    key: 'passive_voice',
    title: 'Passive Voice',
    category: 'Sentence Structure',
    level: 'Intermediate',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Passive Voice</h2>
        <p class="mb-6 text-slate-600">Bentuk kalimat di mana subjek menerima aksi, bukan melakukan aksi. Fokusnya adalah pada aksi itu sendiri.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Fungsi & Rumus</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Kapan Digunakan:</b> Saat pelaku aksi tidak diketahui, tidak penting, atau sudah jelas.</li>
            <li><b>Rumus Umum:</b> Subject + to be (disesuaikan tense) + Past Participle (V3)</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh (Aktif vs. Pasif)</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p><b>Aktif:</b> The company <strong>builds</strong> a new bridge.</p>
            <p><b>Pasif:</b> A new bridge <strong>is built</strong> by the company.</p>
            <hr class="my-2">
            <p><b>Aktif:</b> Someone <strong>stole</strong> my wallet.</p>
            <p><b>Pasif:</b> My wallet <strong>was stolen</strong>. (Pelaku tidak diketahui)</p>
        </div>
    `
},
{
    key: 'relative_clauses',
    title: 'Relative Clauses',
    category: 'Sentence Structure',
    level: 'Intermediate',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Relative Clauses</h2>
        <p class="mb-6 text-slate-600">Anak kalimat yang berfungsi seperti kata sifat (adjective) untuk memberikan informasi tambahan tentang kata benda (noun).</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Kata Ganti Relatif & Fungsinya</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Who:</b> Untuk orang (sebagai subjek). Contoh: The man <strong>who</strong> called you is my teacher.</li>
            <li><b>Whom:</b> Untuk orang (sebagai objek, lebih formal). Contoh: The man <strong>whom</strong> you met is my teacher.</li>
            <li><b>Which:</b> Untuk benda atau hewan. Contoh: The book <strong>which</strong> is on the table is mine.</li>
            <li><b>That:</b> Bisa untuk orang atau benda (kurang formal). Contoh: The book <strong>that</strong> I read was interesting.</li>
            <li><b>Whose:</b> Untuk kepemilikan. Contoh: The student <strong>whose</strong> bag is lost is crying.</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh dalam Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p>I know the girl <strong class="text-blue-600">who won the competition</strong>.</p>
            <p>This is the cake <strong class="text-blue-600">which she made for me</strong>.</p>
        </div>
    `
},
{
    key: 'reported_speech',
    title: 'Reported Speech (Indirect Speech)',
    category: 'Sentence Structure',
    level: 'Advanced',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Reported Speech</h2>
        <p class="mb-6 text-slate-600">Digunakan untuk melaporkan apa yang dikatakan orang lain, biasanya dengan mengubah tenses dan pronoun.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Perubahan Umum (Backshift)</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Direct:</b> "I <strong>am</strong> happy." → <b>Indirect:</b> She said that she <strong>was</strong> happy. (Present → Past)</li>
            <li><b>Direct:</b> "I <strong>will</strong> come." → <b>Indirect:</b> He said that he <strong>would</strong> come. (Will → Would)</li>
            <li><b>Direct:</b> "I <strong>went</strong> to the party." → <b>Indirect:</b> She said that she <strong>had gone</strong> to the party. (Past → Past Perfect)</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p><b>Direct:</b> John said, "I am studying."</p>
            <p><b>Indirect:</b> John said that he <strong class="text-blue-600">was studying</strong>.</p>
            <hr class="my-2">
            <p><b>Direct:</b> Sarah told me, "I will call you tomorrow."</p>
            <p><b>Indirect:</b> Sarah told me that she <strong class="text-blue-600">would call me the next day</strong>.</p>
        </div>
    `
}, // <-- Pastikan ada koma setelah materi terakhir Anda

{
    key: 'question_tags',
    title: 'Question Tags',
    category: 'Sentence Structure',
    level: 'Intermediate',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Question Tags</h2>
        <p class="mb-6 text-slate-600">Pertanyaan singkat yang ditambahkan di akhir sebuah pernyataan untuk meminta konfirmasi.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Aturan Dasar</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Pernyataan Positif → Tag Negatif:</b> You are a student, <strong>aren't you?</strong></li>
            <li><b>Pernyataan Negatif → Tag Positif:</b> She isn't busy, <strong>is she?</strong></li>
            <li>Gunakan <i>auxiliary verb</i> (kata kerja bantu) yang sesuai dengan <i>tense</i> pada pernyataan.</li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh Kalimat</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p>It's a beautiful day, <strong class="text-blue-600">isn't it?</strong></p>
            <p>They went to the party, <strong class="text-blue-600">didn't they?</strong></p>
            <p>You haven't seen this movie, <strong class="text-blue-600">have you?</strong></p>
            <p>He will be here soon, <strong class="text-blue-600">won't he?</strong></p>
        </div>
    `
},
{
    key: 'inversions',
    title: 'Inversions (Kalimat Inversi)',
    category: 'Sentence Structure',
    level: 'Advanced',
    explanation: `
        <h2 class="text-2xl font-bold mb-3">Inversions (Kalimat Inversi)</h2>
        <p class="mb-6 text-slate-600">Pembalikan urutan subjek dan kata kerja bantu (auxiliary verb) untuk memberikan penekanan, biasanya setelah kata keterangan negatif.</p>
        
        <h3 class="font-semibold text-slate-800 mb-2">Struktur & Pemicu</h3>
        <ul class="list-disc list-inside text-slate-600 space-y-1 mb-6">
            <li><b>Struktur:</b> Negative Adverb + Auxiliary Verb + Subject + Main Verb.</li>
            <li><b>Pemicu Umum:</b> <i>Never, Rarely, Seldom, Not only..., No sooner..., Little..., Under no circumstances...</i></li>
        </ul>

        <h3 class="font-semibold text-slate-800 mb-2">Contoh (Normal vs. Inversi)</h3>
        <div class="p-4 bg-slate-50 rounded-lg text-sm space-y-2">
            <p><b>Normal:</b> I have <strong>never</strong> seen such a beautiful sight.</p>
            <p><b>Inversi:</b> <strong>Never</strong> have I seen such a beautiful sight.</p>
            <hr class="my-2">
            <p><b>Normal:</b> She <strong>not only</strong> sings, but she also plays the piano.</p>
            <p><b>Inversi:</b> <strong>Not only</strong> does she sing, but she also plays the piano.</p>
            <hr class="my-2">
            <p><b>Normal:</b> He had <strong>no sooner</strong> arrived than the phone rang.</p>
            <p><b>Inversi:</b> <strong>No sooner</strong> had he arrived than the phone rang.</p>
        </div>
    `
}];

const VIDEO_LIBRARY = [
    {
        title: 'Menguasai 5 Tenses Tingkat Dasar: Simple Present, Continuous, Past, dan Future',
        videoId: 'lRKKYTcRkQ4', // Cukup ID videonya saja
        category: 'Tenses',
        level: 'Beginner',
        description: 'Penjelasan dasar dan lengkap mengenai Simple Present, Present Continuous, Simple Past, Past Continuous, Simple Future.'
    },
    {
        title: 'Menguasai 3 Tenses Tingkat Menengah: Present Perfect, Past Perfect, dan Future Continuous',
        videoId: '2F_UIBiiYhQ', // Cukup ID videonya saja
        category: 'Tenses',
        level: 'Intermediate',
        description: 'Penjelasan dasar dan lengkap mengenai Present Perfect, Past Perfect, dan Future Continuous.'
    },
    {
        title: 'Menguasai 4 Tenses Tingkat Lanjutan: Present Perfect Continuous, Past Perfect Continuous, Future Perfect Tense dan Future Perfect Continuous',
        videoId: 'Wx277qWr6ho', // Cukup ID videonya saja
        category: 'Tenses',
        level: 'Advanced',
        description: 'Penjelasan dasar dan lengkap mengenai Present Perfect Continuous, Past Perfect Continuous, Future Perfect Tense dan Future Perfect Continuous.'
    },
    {
        title: 'Dasar-Dasar Grammar: Membedah Perbedaan Adjectives vs. Adverbs dan Nouns Countable vs. Uncountable',
        videoId: 'dGEohRNXNPw', // Cukup ID videonya saja
        category: 'Parts of Speech',
        level: 'Beginner',
        description: 'Penjelasan dasar dan lengkap mengenai penggunaan Adjectiva, Adverbs, Nouns Countable, dan Uncountable.'
    },
    {
        title: 'Agar Kalimat Tak Lagi Kaku: Panduan Praktis Conjunctions, Modal Verbs, dan Gerunds',
        videoId: 'g6xNtNWM3zc', // Cukup ID videonya saja
        category: 'Parts of Speech',
        level: 'Intermediate',
        description: 'Penjelasan dasar dan lengkap mengenai penggunaan Conjunctions, Modal Verbs, dan Gerunds.'
    },
    {
        title: 'Panduan Lengkap 4 Struktur Kalimat Lanjutan: Dari Kalimat Pengandaian Hingga Pertanyaan "...kan?',
        videoId: 'tqrjqkhyOtA', // Cukup ID videonya saja
        category: 'Sentence Structure',
        level: 'Intermediate',
        description: 'Penjelasan dasar dan lengkap mengenai Conditional Sentences (If-Clauses), Relative Clauses, Passive Voice, dan Question Tags.'
    },
    {
        title: 'Puncak Grammar Inggris: Rahasia di Balik Kalimat Inversi dan Reported Speech',
        videoId: 'JWN_u-5OPQA', // Cukup ID videonya saja
        category: 'Sentence Structure',
        level: 'Advanced',
        description: 'Penjelasan dasar dan lengkap mengenai Reported Speech (Indirect Speech), dan Inversions (Kalimat Inversi).'
    },

];

// --- GRAMMAR GUIDE FEATURE (LENGKAP DENGAN TAB DAN FILTER) ---

function startGrammarGuide() {
    const grammarSection = document.getElementById('grammarSection');
    grammarSection.innerHTML = `
        ${createSectionHeader('Panduan Grammar')}
        <div class="mb-6 border-b border-slate-200">
            <button id="textTabBtn" class="tab-btn py-2 px-4 font-semibold">Materi Teks</button>
            <button id="videoTabBtn" class="tab-btn py-2 px-4 font-semibold">Pustaka Video</button>
        </div>
        <div id="grammarContentArea"></div>
    `;

    const textTabBtn = document.getElementById('textTabBtn');
    const videoTabBtn = document.getElementById('videoTabBtn');
    const contentArea = document.getElementById('grammarContentArea');

    const switchTab = (activeTab) => {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('border-b-2', 'border-blue-500', 'text-blue-600');
            btn.classList.add('text-slate-500', 'hover:text-blue-600');
        });
        activeTab.classList.add('border-b-2', 'border-blue-500', 'text-blue-600');
        activeTab.classList.remove('text-slate-500', 'hover:text-blue-600');

        if (activeTab.id === 'textTabBtn') {
            renderTextView(contentArea);
        } else {
            renderVideoView(contentArea);
        }
    };

    textTabBtn.addEventListener('click', () => switchTab(textTabBtn));
    videoTabBtn.addEventListener('click', () => switchTab(videoTabBtn));

    // Tampilkan tab materi teks sebagai default
    switchTab(textTabBtn);
    showSection('grammarSection');
}

// Fungsi untuk merender tampilan Materi Teks dengan Filter
function renderTextView(container) {
    const uniqueCategories = [...new Set(GRAMMAR_TOPICS.map(topic => topic.category).filter(Boolean))];
    const uniqueLevels = [...new Set(GRAMMAR_TOPICS.map(topic => topic.level).filter(Boolean))];

    container.innerHTML = `
        <div class="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <input type="text" id="grammarSearchInput" class="md:col-span-1 block w-full rounded-md border-slate-300 shadow-sm" placeholder="🔍 Cari topik...">
            <div class="relative">
                <select id="grammarCategoryFilter" class="custom-select">
                    <option value="">Semua Kategori</option>
                    ${uniqueCategories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
                </select>
                <i class="fas fa-chevron-down absolute top-1/2 right-4 -translate-y-1/2 text-slate-400 pointer-events-none"></i>
            </div>
            <div class="relative">
                <select id="grammarLevelFilter" class="custom-select">
                    <option value="">Semua Level</option>
                    ${uniqueLevels.map(lvl => `<option value="${lvl}">${lvl}</option>`).join('')}
                </select>
                <i class="fas fa-chevron-down absolute top-1/2 right-4 -translate-y-1/2 text-slate-400 pointer-events-none"></i>
            </div>
        </div>
        <div id="grammarTopicList" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>
    `;

    const searchInput = document.getElementById('grammarSearchInput');
    const categoryFilter = document.getElementById('grammarCategoryFilter');
    const levelFilter = document.getElementById('grammarLevelFilter');
    const listContainer = document.getElementById('grammarTopicList');
    const grammarProgress = JSON.parse(localStorage.getItem('grammarProgress')) || {};

    const renderTopics = (topicsToRender) => {
        listContainer.innerHTML = '';
        if (topicsToRender.length === 0) {
            listContainer.innerHTML = `<p class="text-slate-500 md:col-span-2 text-center py-8">Tidak ada materi yang cocok dengan filter Anda.</p>`;
            return;
        }
        topicsToRender.forEach(topic => {
            const progress = grammarProgress[topic.key];
            const topicCard = document.createElement('div');
            topicCard.className = 'p-4 border rounded-lg hover:bg-slate-50 hover:border-blue-500 cursor-pointer flex justify-between items-start';
            topicCard.innerHTML = `
                <div>
                    <h4 class="font-bold text-lg text-slate-800">${topic.title}</h4>
                    <div class="flex items-center flex-wrap gap-2 mt-1">
                        ${topic.category ? `<span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">${topic.category}</span>` : ''}
                        ${topic.level ? `<span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">${topic.level}</span>` : ''}
                    </div>
                    ${progress ? `<span class="text-xs text-slate-500 mt-2 block">Skor terakhir: ${progress.score}/${progress.total}</span>` : ''}
                </div>
                ${progress ? `<i class="fas fa-check-circle text-green-500 text-xl flex-shrink-0 ml-4 mt-1"></i>` : ''}
            `;
            topicCard.dataset.key = topic.key;
            topicCard.addEventListener('click', () => displayGrammarTopic(topic.key));
            listContainer.appendChild(topicCard);
        });
    };

    const applyFilters = () => {
        const searchTerm = searchInput.value.toLowerCase();
        const selectedCategory = categoryFilter.value;
        const selectedLevel = levelFilter.value;

        let filteredTopics = GRAMMAR_TOPICS;
        if (searchTerm) {
            filteredTopics = filteredTopics.filter(topic => topic.title.toLowerCase().includes(searchTerm));
        }
        if (selectedCategory) {
            filteredTopics = filteredTopics.filter(topic => topic.category === selectedCategory);
        }
        if (selectedLevel) {
            filteredTopics = filteredTopics.filter(topic => topic.level === selectedLevel);
        }
        renderTopics(filteredTopics);
    };

    searchInput.addEventListener('input', applyFilters);
    categoryFilter.addEventListener('change', applyFilters);
    levelFilter.addEventListener('change', applyFilters);

    applyFilters(); // Render awal
}

// Fungsi untuk merender Pustaka Video (tetap sama)
function renderVideoView(container) {
    const videosByCategory = VIDEO_LIBRARY.reduce((acc, video) => {
        (acc[video.category] = acc[video.category] || []).push(video);
        return acc;
    }, {});

    let html = '<div class="space-y-8">';
    for (const category in videosByCategory) {
        html += `<div>
                    <h3 class="text-xl font-bold mb-4">${category}</h3>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        ${videosByCategory[category].map(video => `
                            <div class="video-card cursor-pointer group" data-video-id="${video.videoId}">
                                <div class="relative overflow-hidden rounded-lg">
                                    <img src="https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg" class="w-full transition-transform duration-300 group-hover:scale-110"/>
                                    <div class="absolute inset-0 bg-black/20 flex items-center justify-center">
                                        <i class="fas fa-play-circle text-white text-4xl opacity-80"></i>
                                    </div>
                                </div>
                                <h4 class="font-semibold mt-2">${video.title}</h4>
                                <p class="text-sm text-slate-500">${video.description}</p>
                            </div>
                        `).join('')}
                    </div>
                </div>`;
    }
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.video-card').forEach(card => {
        card.addEventListener('click', () => {
            playVideoInModal(card.dataset.videoId);
        });
    });
}

function displayGrammarTopic(topicKey) {
    const grammarSection = document.getElementById('grammarSection');
    const topic = GRAMMAR_TOPICS.find(t => t.key === topicKey);
    if (!topic) return;

    grammarSection.innerHTML = `
        <div class="flex justify-between items-center mb-6 border-b pb-4">
            <h3 class="text-2xl font-bold">${topic.title}</h3>
            <button id="backToGrammarMenu" class="btn-secondary !py-2 !px-4 text-sm"><i class="fas fa-arrow-left mr-2"></i>Kembali ke Menu</button>
        </div>
        <div class="prose max-w-none">
            ${topic.explanation}
        </div>
        <div class="mt-8 border-t pt-6 text-center">
            <h4 class="font-bold text-lg mb-3">Siap untuk Latihan?</h4>
            <p class="text-slate-500 mb-4">Uji pemahaman Anda dengan 5 soal yang dibuat oleh AI.</p>
            <button id="startGrammarExerciseBtn" class="btn-primary">Mulai Latihan</button>
        </div>
        <div id="grammarExerciseContainer" class="mt-8"></div>
    `;

    document.getElementById('backToGrammarMenu').addEventListener('click', startGrammarGuide);
    document.getElementById('startGrammarExerciseBtn').addEventListener('click', () => generateGrammarExercise(topicKey));
}

// --- INTERACTIVE MIND MAP FEATURE ---
// --- INTERACTIVE MIND MAP FEATURE (VERSI FINAL LENGKAP) ---
let mindMapInstance;
let selectedNodeForAction = null;

// Fungsi helper untuk merender atau memuat mind map
function renderMindMap(elements) {
    if (mindMapInstance) {
        mindMapInstance.destroy();
    }
    mindMapInstance = cytoscape({
        container: document.getElementById('cy'),
        elements: elements,
        style: [
            {
                selector: 'node',
                style: {
                    'label': 'data(label)', 'text-wrap': 'wrap', 'text-max-width': '120px',
                    'font-size': '12px', 'text-valign': 'center', 'text-halign': 'center',
                    'width': 'label', 'height': 'label', 'padding': '15px'
                }
            },
            { selector: '.center-node', style: { 'background-color': '#2563eb', 'color': 'white', 'font-weight': 'bold', 'shape': 'round-rectangle' } },
            { selector: '.sub-node', style: { 'background-color': '#eef2ff', 'border-color': '#6366f1', 'border-width': 2, 'color': '#4338ca', 'shape': 'round-rectangle' } },
            { selector: 'edge', style: { 'width': 2, 'line-color': '#cbd5e1', 'target-arrow-color': '#cbd5e1', 'curve-style': 'bezier' } }
        ],
        layout: { name: 'cose', animate: 'end', padding: 50, idealEdgeLength: 120 }
    });

    const toolbar = document.getElementById('mindMapToolbar');
    const selectedNodeLabel = document.getElementById('selectedNodeLabel');

    // Event listener untuk memunculkan toolbar
    mindMapInstance.on('tap', 'node', (event) => {
        selectedNodeForAction = event.target;
        selectedNodeLabel.textContent = selectedNodeForAction.data('label');
        document.getElementById('toolbarShapeSelect').value = selectedNodeForAction.style('shape');
        toolbar.classList.remove('hidden');
    });

    // Sembunyikan toolbar
    mindMapInstance.on('tap', (event) => {
        if (event.target === mindMapInstance) {
            toolbar.classList.add('hidden');
            selectedNodeForAction = null;
        }
    });

    // Klik kanan untuk perluas dengan AI
    mindMapInstance.on('cxttap', 'node', (event) => {
        const tappedNode = event.target;
        if (confirm(`Apakah Anda ingin memperluas topik "${tappedNode.data('label')}" dengan bantuan AI?`)) {
            expandNodeWithAI(tappedNode);
        }
    });
}

function startMindMapFeature() {
    const mindMapSection = document.getElementById('mindMapSection');
    mindMapSection.innerHTML = `
        ${createSectionHeader('Mind Map Otomatis')}

        <div class="mb-8 border rounded-lg bg-slate-50">
            <button id="toggleGuideBtn" class="w-full flex justify-between items-center p-4">
                <span class="font-bold text-slate-700"><i class="fas fa-info-circle mr-2 text-blue-500"></i> Cara Penggunaan</span>
                <i id="guideIcon" class="fas fa-chevron-down transition-transform"></i>
            </button>
            <div id="guideContent" class="px-4 text-sm text-slate-600">
                <ol class="list-decimal list-inside space-y-2">
                    <li><strong>Masukkan Teks:</strong> Salin teks Anda ke dalam kotak "1. Masukkan Teks".</li>
                    <li><strong>Buat Peta:</strong> Klik tombol "Buat Mind Map Baru".</li>
                    <li><strong>Interaksi Node:</strong>
                        <ul class="list-disc list-inside ml-4">
                            <li><strong>Klik Kiri:</strong> Untuk memilih node dan menampilkan toolbar aksi di bawah peta.</li>
                            <li><strong>Klik Kanan / Tekan Lama:</strong> Untuk memperluas node dengan ide turunan dari AI.</li>
                        </ul>
                    </li>
                     <li><strong>Navigasi:</strong> Gunakan tombol (+), (-), dan (⤧) untuk mengatur zoom dan posisi.</li>
                     <li><strong>Simpan & Buka:</strong> Gunakan tombol di panel kontrol untuk menyimpan dan membuka peta Anda.</li>
                </ol>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div class="lg:col-span-1 dashboard-widget space-y-6">
                <div>
                    <h3 class="widget-title">1. Masukkan Teks</h3>
                    <textarea id="mindMapInput" class="block w-full rounded-md border-slate-300 shadow-sm" rows="8" placeholder="Masukkan teks Anda di sini..."></textarea>
                </div>
                <div>
    <h3 class="widget-title">2. Aksi Peta</h3>
    <div class="space-y-2">
        <button id="generateMindMapBtn" class="w-full flex items-center justify-center gap-2 btn-primary">
            <i class="fas fa-magic"></i>
            <span>Buat Mind Map Baru</span>
        </button>
        <div class="grid grid-cols-2 gap-2">
            <button id="saveMindMapBtn" class="w-full flex items-center justify-center gap-2 btn-secondary">
                <i class="fas fa-save"></i>
                <span>Simpan</span>
            </button>
            <button id="loadMindMapBtn" class="w-full flex items-center justify-center gap-2 btn-secondary">
                <i class="fas fa-folder-open"></i>
                <span>Buka</span>
            </button>
        </div>
        <button id="downloadPngBtn" class="w-full flex items-center justify-center gap-2 btn-secondary bg-green-100 text-green-700 hover:bg-green-200">
            <i class="fas fa-download"></i>
            <span>Unduh PNG</span>
        </button>
    </div>
</div>
            </div>

            <div class="lg:col-span-2 dashboard-widget">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="widget-title">3. Visualisasi Mind Map</h3>
                    <div class="flex gap-2">
                        <button id="zoomInBtn" class="btn-secondary !py-2 !px-3" title="Perbesar"><i class="fas fa-plus"></i></button>
                        <button id="zoomOutBtn" class="btn-secondary !py-2 !px-3" title="Perkecil"><i class="fas fa-minus"></i></button>
                        <button id="recenterMindMapBtn" class="btn-secondary !py-2 !px-3" title="Fokuskan Ulang"><i class="fas fa-expand-arrows-alt"></i></button>
                    </div>
                </div>
                <div id="cy"></div>
                <div id="mindMapToolbar" class="hidden mt-4 p-3 bg-slate-100 rounded-lg flex items-center justify-between flex-wrap gap-4">
                    <div><span class="text-sm font-medium text-slate-500">Node Terpilih:</span><strong id="selectedNodeLabel" class="ml-2 text-slate-800"></strong></div>
                    <div class="flex items-center gap-2">
                        <select id="toolbarShapeSelect" title="Ubah Bentuk" class="custom-select !text-sm !py-1 !pl-2 !pr-8 rounded-md bg-white">
                            <option value="round-rectangle">Persegi</option><option value="ellipse">Lingkaran</option><option value="triangle">Segitiga</option><option value="rhomboid">Jajar Genjang</option><option value="diamond">Berlian</option><option value="star">Bintang</option>
                        </select>
                        <button id="toolbarEditBtn" class="btn-secondary !py-1 !px-3 text-sm"><i class="fas fa-pencil-alt mr-2"></i>Edit</button>
                        <button id="toolbarAddBtn" class="btn-secondary !py-1 !px-3 text-sm"><i class="fas fa-plus mr-2"></i>Tambah</button>
                        <button id="toolbarDeleteBtn" class="bg-red-100 text-red-700 hover:bg-red-200 font-semibold !py-1 !px-3 text-sm rounded-md"><i class="fas fa-trash mr-2"></i>Hapus</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // --- Event Listeners Lengkap untuk Tampilan Modern ---
    document.getElementById('toggleGuideBtn').addEventListener('click', () => {
        document.getElementById('guideContent').classList.toggle('open');
        document.getElementById('guideIcon').classList.toggle('rotate-180');
    });

    document.getElementById('generateMindMapBtn').addEventListener('click', generateMindMap);
    document.getElementById('saveMindMapBtn').addEventListener('click', saveCurrentMindMap);
    document.getElementById('loadMindMapBtn').addEventListener('click', openLoadMapModal);

    document.getElementById('zoomInBtn').addEventListener('click', () => { if (mindMapInstance) mindMapInstance.zoom(mindMapInstance.zoom() * 1.2); });
    document.getElementById('zoomOutBtn').addEventListener('click', () => { if (mindMapInstance) mindMapInstance.zoom(mindMapInstance.zoom() / 1.2); });
    document.getElementById('recenterMindMapBtn').addEventListener('click', () => {
        if (mindMapInstance) mindMapInstance.animate({ fit: { eles: mindMapInstance.elements(), padding: 50 }, duration: 500 });
    });


    document.getElementById('toolbarEditBtn').addEventListener('click', () => {
        if (!selectedNodeForAction) return;
        const currentLabel = selectedNodeForAction.data('label');
        const newLabel = prompt("Edit teks untuk node ini:", currentLabel);
        if (newLabel && newLabel.trim() !== '') {
            selectedNodeForAction.data('label', newLabel.trim());
            document.getElementById('selectedNodeLabel').textContent = newLabel.trim();
        }
    });

    // Di dalam startMindMapFeature(), tambahkan listener untuk tombol unduh
    document.getElementById('downloadPngBtn').addEventListener('click', () => {
        if (!mindMapInstance) {
            showToast("Tidak ada mind map untuk diunduh.", "error");
            return;
        }

        // Ambil data gambar dalam format base64 dari Cytoscape
        const png64 = mindMapInstance.png({
            output: 'base64uri',
            bg: 'white', // Atur latar belakang menjadi putih
            full: true // Pastikan seluruh mind map terambil, bukan hanya yang terlihat
        });

        // Buat elemen link sementara untuk memicu unduhan
        const link = document.createElement('a');
        link.href = png64;
        link.download = `mind-map-${Date.now()}.png`; // Nama file
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast("Mind map sedang diunduh...", "success");
    });

    document.getElementById('toolbarAddBtn').addEventListener('click', () => {
        if (!selectedNodeForAction) return;
        const newLabel = prompt("Masukkan nama sub-topik baru:");
        if (newLabel && newLabel.trim() !== '') {
            const sourceNodeId = selectedNodeForAction.id();
            const newId = `${sourceNodeId}_m_${Date.now()}`;
            mindMapInstance.add([
                { group: 'nodes', data: { id: newId, label: newLabel.trim() }, classes: 'sub-node' },
                { group: 'edges', data: { source: sourceNodeId, target: newId } }
            ]);
            mindMapInstance.layout({ name: 'cose', animate: 'end', padding: 30 }).run();
        }
    });

    document.getElementById('toolbarDeleteBtn').addEventListener('click', () => {
        if (!selectedNodeForAction) return;
        if (confirm(`Yakin ingin menghapus node "${selectedNodeForAction.data('label')}"?`)) {
            mindMapInstance.remove(selectedNodeForAction);
            document.getElementById('mindMapToolbar').classList.add('hidden');
            selectedNodeForAction = null;
        }
    });

    document.getElementById('toolbarShapeSelect').addEventListener('change', (e) => {
        if (selectedNodeForAction) {
            selectedNodeForAction.style('shape', e.target.value);
        }
    });

    showSection('mindMapSection');
}

async function generateMindMap() {
    const textInput = document.getElementById('mindMapInput').value;
    if (!textInput.trim()) { showToast("Silakan masukkan teks.", "error"); return; }
    showLoading(true, "Menganalisis teks...");

    try {
        const payload = {
            contents: [{ parts: [{ text: `Analyze the following text. Identify the central topic and up to 6 key sub-topics. Format as a single JSON object with a 'central_topic' (string) and 'sub_topics' (an array of strings). Text: "${textInput}"` }] }],
            generationConfig: { responseMimeType: "application/json" }
        };
        const result = await callGeminiAPI(payload);
        const data = JSON.parse(result.candidates[0].content.parts[0].text);

        const elements = [{ group: 'nodes', data: { id: 'center', label: data.central_topic }, classes: 'center-node' }];
        data.sub_topics.forEach((topic, i) => {
            const nodeId = `node_${i}`;
            elements.push({ group: 'nodes', data: { id: nodeId, label: topic }, classes: 'sub-node' });
            elements.push({ group: 'edges', data: { id: `edge_${i}`, source: 'center', target: nodeId } });
        });

        renderMindMap(elements); // Panggil fungsi render terpusat

    } catch (error) {
        console.error("Error generating mind map:", error);
        showToast("Gagal membuat mind map dari teks.", "error");
    } finally {
        showLoading(false);
    }
}

function saveCurrentMindMap() {
    if (!mindMapInstance) { showToast("Tidak ada mind map untuk disimpan.", "error"); return; }
    const mapName = prompt("Beri nama untuk mind map ini:", `Peta ${new Date().toLocaleDateString('id-ID')}`);
    if (!mapName || !mapName.trim()) return;

    const savedMaps = JSON.parse(localStorage.getItem('savedMindMaps')) || [];
    const newSave = {
        id: `map_${Date.now()}`, name: mapName, date: new Date().toISOString(),
        elements: mindMapInstance.json().elements
    };
    savedMaps.unshift(newSave);
    localStorage.setItem('savedMindMaps', JSON.stringify(savedMaps));
    showToast(`Mind map "${mapName}" berhasil disimpan!`);
}

function openLoadMapModal() {
    const modal = document.getElementById('loadMindMapModal');
    const listContainer = document.getElementById('savedMapsList');
    const savedMaps = JSON.parse(localStorage.getItem('savedMindMaps')) || [];

    if (savedMaps.length === 0) {
        listContainer.innerHTML = `<p class="text-slate-500 text-center">Tidak ada peta yang tersimpan.</p>`;
    } else {
        listContainer.innerHTML = savedMaps.map(map => `
            <div class="p-3 border rounded-lg flex justify-between items-center">
                <div><p class="font-semibold">${map.name}</p><p class="text-xs text-slate-400">${new Date(map.date).toLocaleString('id-ID')}</p></div>
                <div class="flex gap-2">
                    <button class="open-map-btn btn-primary !py-1 !px-3 text-sm" data-map-id="${map.id}">Buka</button>
                    <button class="delete-map-btn bg-red-100 text-red-700 !py-1 !px-3 text-sm rounded-md" data-map-id="${map.id}">Hapus</button>
                </div>
            </div>`).join('');
    }
    modal.classList.remove('hidden');

    document.getElementById('closeLoadModalBtn').addEventListener('click', () => modal.classList.add('hidden'), { once: true });

    listContainer.onclick = (e) => { // Gunakan event delegation
        const openBtn = e.target.closest('.open-map-btn');
        const deleteBtn = e.target.closest('.delete-map-btn');
        if (openBtn) {
            const mapId = openBtn.dataset.mapId;
            const mapToLoad = savedMaps.find(m => m.id === mapId);
            if (mapToLoad) {
                renderMindMap(mapToLoad.elements);
                modal.classList.add('hidden');
                showToast(`Mind map "${mapToLoad.name}" dimuat.`, "success");
            }
        }
        if (deleteBtn) {
            const mapId = deleteBtn.dataset.mapId;
            if (confirm("Yakin ingin menghapus mind map ini?")) {
                const newSavedMaps = savedMaps.filter(m => m.id !== mapId);
                localStorage.setItem('savedMindMaps', JSON.stringify(newSavedMaps));
                openLoadMapModal(); // Render ulang daftar
            }
        }
    };
}

async function expandNodeWithAI(node) {
    const topic = node.data('label');
    const nodeId = node.id();
    node.addClass('loading-node');
    showToast(`AI sedang mencari ide turunan untuk "${topic}"...`, 'success');
    try {
        const existingLabels = mindMapInstance.nodes().map(n => n.data('label'));
        const payload = {
            contents: [{ parts: [{ text: `For the topic "${topic}", provide 3 to 4 related key concepts or examples. Do not repeat any topics from this existing list: [${existingLabels.join(', ')}]. Format as a simple JSON array of strings.` }] }],
            generationConfig: { responseMimeType: "application/json" }
        };
        const result = await callGeminiAPI(payload);
        const newTopics = JSON.parse(result.candidates[0].content.parts[0].text);
        if (newTopics && newTopics.length > 0) {
            const newElements = [];
            newTopics.forEach((newTopic, i) => {
                const newId = `${nodeId}_${i}_${Date.now()}`;
                newElements.push({ group: 'nodes', data: { id: newId, label: newTopic }, classes: 'sub-node' });
                newElements.push({ group: 'edges', data: { source: nodeId, target: newId } });
            });
            mindMapInstance.add(newElements);
            mindMapInstance.layout({ name: 'cose', animate: 'end', padding: 30, idealEdgeLength: 100 }).run();
        } else {
            showToast(`Tidak ada ide turunan baru yang ditemukan untuk "${topic}".`, 'success');
        }
    } catch (error) {
        console.error("Error expanding node:", error);
        showToast("Gagal memperluas topik.", "error");
    } finally {
        node.removeClass('loading-node');
    }
}

// --- LOCAL NOTIFICATIONS FEATURE ---

async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        showToast("Browser ini tidak mendukung notifikasi.", "error");
        return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        showToast("Terima kasih! Notifikasi telah diaktifkan.", "success");
    } else if (permission === 'denied') {
        showToast("Anda telah memblokir notifikasi.", "error");
    } else {
        showToast("Anda perlu mengizinkan notifikasi untuk fitur ini.", "error");
    }
}

function showTestNotification() {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
        showToast("Notifikasi belum diizinkan oleh pengguna.", "error");
        return;
    }

    // Pastikan Service Worker sudah aktif sebelum mengirim pesan
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            command: 'showTestNotification'
        });
        showToast("Perintah notifikasi tes telah dikirim!", "success");
    } else {
        showToast("Service worker belum siap. Coba refresh halaman lalu coba lagi.", "error");
    }
}

function updateNotificationIconState() {
    if (!('Notification' in window)) return;

    const notificationBtn = document.getElementById('dailyNotificationBtn');
    const isScheduled = localStorage.getItem('dailyNotificationScheduled') === 'true';

    // Ikon aktif HANYA JIKA izin diberikan DAN ada jadwal yang ditandai aktif
    if (Notification.permission === 'granted' && isScheduled) {
        notificationBtn.classList.add('notification-active');
        notificationBtn.title = 'Notifikasi harian aktif. Klik untuk menonaktifkan.';
    } else {
        notificationBtn.classList.remove('notification-active');
        notificationBtn.title = 'Atur Notifikasi Harian';
    }
}

async function generateGrammarExercise(topicKey) {
    const topic = GRAMMAR_TOPICS.find(t => t.key === topicKey);
    showLoading(true, `Membuat soal latihan untuk "${topic.title}"...`);
    try {
        const payload = {
            contents: [{
                parts: [{
                    text: `Generate 5 multiple-choice grammar questions to test understanding of "${topic.title}". The questions should be in English. Every question object must have: "question", "options" (array of 4 strings), "answer" (string, "A"-"D"), and "explanation" (string, in simple Indonesian). Format as a single JSON array of objects.`
                }]
            }],
            generationConfig: {
                responseMimeType: "application/json"
            }
        };
        const result = await callGeminiAPI(payload);
        let rawText = result.candidates[0].content.parts[0].text;
        // Cari blok JSON yang valid di dalam teks, apapun formatnya
        const jsonMatch = rawText.match(/\[.*\]|\{.*\}/s);
        if (jsonMatch) {
            try {
                const questions = JSON.parse(jsonMatch[0]);
                displayGrammarExercise(questions, topicKey);
            } catch (e) {
                console.error("Failed to parse JSON:", e);
                showToast("Gagal memproses data dari AI.", 'error');
            }
        } else {
            showToast("Respons dari AI tidak valid.", 'error');
        }
    } catch (error) {
        console.error("Error generating grammar exercise:", error);
        showToast("Gagal membuat soal latihan.", 'error');
    } finally {
        showLoading(false);
    }
}

function displayGrammarExercise(questions, topicKey) {
    const container = document.getElementById('grammarExerciseContainer');
    let currentQuestionIndex = 0;
    let userAnswers = {};

    const renderQuestion = () => {
        const q = questions[currentQuestionIndex];
        const questionHtml = `
            <h4 class="font-bold text-lg mb-4 text-center">Latihan: Soal ${currentQuestionIndex + 1} dari ${questions.length}</h4>
            <div class="mb-6">
                <p class="font-semibold text-lg mb-4">${q.question}</p>
                <div class="space-y-3">
                    ${q.options.map((opt, i) => {
            const optionLetter = String.fromCharCode(65 + i);
            return `<label class="flex items-center p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
                            <input type="radio" name="q_answer" value="${optionLetter}" class="mr-3 h-4 w-4 text-blue-600 border-slate-300 focus:ring-blue-500">
                            <span>${optionLetter}. ${opt}</span>
                        </label>`;
        }).join('')}
                </div>
            </div>
            <div class="flex justify-end mt-6">
                <button id="nextGrammarQuestionBtn" class="btn-primary">${currentQuestionIndex === questions.length - 1 ? 'Selesai' : 'Berikutnya'}</button>
            </div>
        `;
        container.innerHTML = questionHtml;

        document.getElementById('nextGrammarQuestionBtn').addEventListener('click', () => {
            const selected = container.querySelector('input[name="q_answer"]:checked');
            if (!selected) {
                showToast("Silakan pilih jawaban.", 'error');
                return;
            }
            userAnswers[currentQuestionIndex] = selected.value;
            if (currentQuestionIndex < questions.length - 1) {
                currentQuestionIndex++;
                renderQuestion();
            } else {
                finishGrammarExercise(questions, userAnswers, topicKey);
            }
        });
    };
    renderQuestion();
    document.getElementById('startGrammarExerciseBtn').style.display = 'none'; // Sembunyikan tombol mulai
}

function finishGrammarExercise(questions, userAnswers, topicKey) {
    const container = document.getElementById('grammarExerciseContainer');
    let score = 0;
    let resultsHtml = '<div><h3 class="text-xl font-bold mb-4 text-center">Hasil Latihan</h3>';

    questions.forEach((q, index) => {
        const userAnswer = userAnswers[index];
        const isCorrect = userAnswer === q.answer;
        if (isCorrect) score++;

        resultsHtml += `
            <div class="mb-4 p-4 rounded-lg border-l-4 ${isCorrect ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}">
                <p class="font-semibold">${index + 1}. ${q.question}</p>
                <p class="text-sm mt-2">Jawaban Anda: <span class="font-bold ${isCorrect ? 'text-green-700' : 'text-red-700'}">${userAnswer}. ${q.options[userAnswer.charCodeAt(0) - 65]}</span></p>
                ${!isCorrect ? `<p class="text-sm">Jawaban Benar: <span class="font-bold text-green-700">${q.answer}. ${q.options[q.answer.charCodeAt(0) - 65]}</span></p>` : ''}
                <div class="mt-3 pt-3 border-t border-slate-200">
                    <p class="text-sm font-semibold text-slate-600">Penjelasan:</p>
                    <p class="text-sm text-slate-500 italic">${q.explanation}</p>
                </div>
            </div>`;
    });
    resultsHtml += '</div>';

    const grammarProgress = JSON.parse(localStorage.getItem('grammarProgress')) || {};
    grammarProgress[topicKey] = {
        score: score,
        total: questions.length,
        lastAttempt: new Date().toISOString()
    };
    localStorage.setItem('grammarProgress', JSON.stringify(grammarProgress));

    const scoreSummaryHtml = `
        <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-8 text-center">
            <h2 class="text-2xl font-bold mb-2">Latihan Selesai!</h2>
            <p class="text-slate-600">Skor Anda:</p>
            <p class="font-extrabold text-4xl text-blue-600 mt-2">${score} / ${questions.length}</p>
            <button id="tryAgainBtn" class="btn-primary mt-6">Coba Latihan Lagi</button>
            <button id="backToTopicBtn" class="btn-secondary mt-6 ml-2">Lihat Penjelasan</button>
            <button id="backToMainMenuBtn" class="btn-secondary mt-6 ml-2">Menu Utama Grammar</button>
        </div>`;

    container.innerHTML = scoreSummaryHtml + resultsHtml;
    document.getElementById('tryAgainBtn').addEventListener('click', () => generateGrammarExercise(topicKey));
    document.getElementById('backToTopicBtn').addEventListener('click', () => displayGrammarTopic(topicKey));
    document.getElementById('backToMainMenuBtn').addEventListener('click', startGrammarGuide);
    handleEndOfActivity();
}

// --- USER GUIDE FEATURE ---

const USER_GUIDE_CONTENT = [
    {
        id: 'doodle_sapaan', title: 'Doodle Sapaan', icon: 'fa-owl',
        description: 'Elemen penyambut dinamis di dasbor Anda.',
        steps: [
            'Setiap kali Anda membuka dasbor, doodle burung hantu akan menampilkan pesan acak yang berbeda.',
            'Pesan ini bisa berupa sapaan, motivasi, atau fakta menarik seputar Bahasa Inggris.',
        ],
        tip: 'Ini adalah fitur visual untuk membuat pengalaman belajar lebih menyenangkan.'
    },
    {
        id: 'pomodoro', title: 'Timer Pomodoro', icon: 'fa-brain',
        description: 'Alat bantu manajemen waktu untuk membantu Anda belajar dengan fokus.',
        steps: [
            'Timer berada di bagian atas halaman dan akan selalu terlihat (sticky).',
            'Klik tombol ► untuk memulai sesi fokus (default 25 menit). Tombol akan berubah menjadi ❚❚ (jeda).',
            'Klik tombol ❚❚ untuk menjeda waktu.',
            'Klik ikon gerigi (⚙️) untuk membuka pengaturan. Anda bisa mengubah durasi fokus, istirahat, dan jumlah ronde.',
            'Setelah sesi fokus selesai, alarm akan berbunyi dan mode akan otomatis berganti ke "Mode Istirahat".'
        ],
        tip: 'Gunakan teknik Pomodoro untuk menjaga konsentrasi dan menghindari kelelahan saat belajar.'
    },
    {
        id: 'latihan_harian', title: 'Latihan Harian', icon: 'fa-pencil-alt',
        description: 'Pemanasan cepat dengan 10 soal grammar acak setiap hari.',
        steps: [
            'Klik kartu "Latihan Harian" di dasbor.',
            'Jawab 10 pertanyaan pilihan ganda.',
            'Setelah selesai, Anda akan melihat skor dan pembahasan untuk setiap soal.'
        ],
        tip: 'Lakukan setiap hari untuk membangun kebiasaan dan memperkuat pemahaman grammar dasar.'
    },
    {
        id: 'tes_mingguan', title: 'Tes Mingguan', icon: 'fa-file-alt',
        description: 'Tes komprehensif gaya TOEFL ITP untuk mengukur dan memperbarui level kemampuan Anda.',
        steps: [
            'Fitur ini hanya bisa diakses satu kali setiap minggu.',
            'Tes terdiri dari 3 bagian: Pemahaman Teks, Struktur, dan Membaca.',
            'Setelah selesai, skor Anda akan menentukan level baru Anda (Beginner, Intermediate, Advanced) yang akan mempengaruhi tingkat kesulitan di beberapa fitur lain.'
        ],
    },
    {
        id: 'flashcards', title: 'Flashcards', icon: 'fa-layer-group',
        description: 'Alat untuk menambah dan melatih kosakata pribadi Anda.',
        steps: [
            'Tab "Latihan Kartu": Lihat kata, lalu klik "Balik Kartu" untuk melihat definisi dan contohnya.',
            'Tab "Tambah Baru": Masukkan kata baru, lalu klik "Isi Otomatis" agar AI mengisi terjemahan, definisi (EN & ID), dan contoh kalimat.',
            'Tab "Kelola Kartu": Edit atau hapus flashcard yang sudah Anda buat.',
            'Anda juga bisa membuat flashcard secara instan dari menu "Rangkuman Buku".'
        ],
    },
    {
        id: 'tanya_ai', title: 'Tanya AI Tutor', icon: 'fa-wand-magic-sparkles',
        description: 'Asisten pribadi Anda untuk semua pertanyaan seputar Bahasa Inggris.',
        steps: [
            'Klik tombol mengambang dengan ikon burung hantu di pojok kanan bawah.',
            'Panel chat akan muncul tanpa meninggalkan halaman Anda saat ini.',
            'Ketik pertanyaan apa pun tentang grammar, kosakata, atau idiom.',
            'Anda juga bisa memilih dari opsi pertanyaan yang disarankan.'
        ],
        tip: 'Gunakan fitur ini saat Anda menemukan kebingungan di tengah-tengah latihan lain.'
    },
    // <-- Pastikan ada koma setelah objek 'tanya_ai'
    {
        id: 'latihan_listening', title: 'Latihan Listening', icon: 'fa-headphones',
        description: 'Menguji dan melatih kemampuan pemahaman pendengaran (listening comprehension).',
        steps: [
            'Klik tombol "Mulai & Putar Audio". Anda hanya memiliki satu kesempatan untuk mendengar percakapan.',
            'Dengarkan percakapan singkat dengan saksama.',
            'Setelah audio selesai, beberapa pertanyaan pilihan ganda akan muncul.',
            'Jawab semua pertanyaan berdasarkan apa yang Anda dengar, lalu lihat hasilnya beserta pembahasan.'
        ],
        tip: 'Fokus pada pertanyaan kunci seperti "who", "what", dan "where" saat Anda mendengarkan.'
    },
    {
        id: 'asisten_dialog', title: 'Asisten Dialog', icon: 'fa-microphone-alt',
        description: 'Berlatih pengucapan dan pemahaman skenario percakapan interaktif.',
        steps: [
            'Pilih salah satu topik yang disarankan atau ketik topik percakapan Anda sendiri.',
            'AI akan membuatkan sebuah skenario dialog antara dua orang.',
            'Klik ikon speaker (🔊) di samping setiap baris dialog untuk mendengar pengucapannya dengan jelas.'
        ],
        tip: 'Cobalah untuk meniru dan mengulangi kalimat yang diucapkan AI untuk melatih aksen dan intonasi Anda.'
    },
    {
        id: 'rangkuman_buku', title: 'Rangkuman Buku', icon: 'fa-book',
        description: 'Membaca intisari buku non-fiksi populer untuk melatih pemahaman bacaan dan menambah wawasan.',
        steps: [
            'Pilih genre buku yang Anda minati, dan AI akan membuatkan rangkumannya.',
            'Saat membaca, klik pada satu kata untuk mendapatkan terjemahan cepat.',
            'Sorot (highlight) sebuah kata atau frasa, lalu klik ikon ungu (tambah flashcard) yang muncul untuk menyimpannya sebagai kosakata baru secara instan.'
        ],
        tip: 'Ini adalah cara yang bagus untuk menambah kosakata kontekstual sambil mendapatkan pengetahuan baru dari buku-buku terbaik.'
    },
    {
        id: 'me_vs_vocab', title: 'Me vs Vocabulary', icon: 'fa-spell-check',
        description: 'Menguji pemahaman kosakata Anda dalam konteks kalimat yang acak dan menyenangkan.',
        steps: [
            'Klik "Putar Roulette" untuk memilih 3 kategori kosakata secara acak.',
            'Mulai tes untuk menjawab 15 soal pilihan ganda.',
            'Setiap soal meminta Anda untuk menerjemahkan kata yang digarisbawahi dalam sebuah kalimat bahasa Inggris.'
        ],
        tip: 'Gunakan konteks kalimat untuk membantu Anda menebak arti kata yang mungkin belum Anda kenal.'
    },
    {
        id: 'writing_the_text', title: 'Writing the Text', icon: 'fa-pen-alt',
        description: 'Melatih kemampuan menulis dan menerjemahkan paragraf dari Bahasa Indonesia ke Bahasa Inggris.',
        steps: [
            'AI akan memberikan sebuah paragraf singkat dalam Bahasa Indonesia.',
            'Tulis versi terjemahan Anda dalam Bahasa Inggris di kotak yang tersedia.',
            'Klik "Periksa Jawaban" untuk mendapatkan umpan balik instan dan mendetail dari AI.',
            'AI akan memberikan versi yang dikoreksi, contoh jawaban benar, dan pembahasan tentang kesalahan Anda.'
        ],
    },
    {
        id: 'panduan_grammar', title: 'Panduan Grammar', icon: 'fa-book-reader',
        description: 'Pusat referensi untuk mempelajari berbagai aturan tata bahasa Inggris beserta latihan interaktif.',
        steps: [
            'Gunakan bilah pencarian untuk menemukan topik yang Anda cari dengan cepat.',
            'Klik salah satu topik untuk membaca penjelasan lengkap beserta contoh-contohnya.',
            'Setelah paham, klik tombol "Mulai Latihan" untuk mengerjakan 5 soal yang dibuat khusus oleh AI untuk topik tersebut.',
            'Topik yang sudah pernah Anda latih akan ditandai dengan ikon centang (✅) dan skor terakhir Anda.'
        ],
    }
    , // <-- Pastikan ada koma setelah objek 'panduan_grammar'
    {
        id: 'target_mingguan', title: 'Target Mingguan', icon: 'fa-bullseye',
        description: 'Mengatur dan melacak target belajar mingguan Anda untuk menjaga konsistensi dan motivasi.',
        steps: [
            'Klik kartu "Target Mingguan" untuk masuk ke halaman pengaturan.',
            'Masukkan jumlah sesi yang ingin Anda selesaikan untuk setiap aktivitas dalam seminggu (misalnya, 3 Latihan Harian, 2 Sesi Dialog).',
            'Klik "Simpan Target".',
            'Progres pencapaian target Anda akan ditampilkan secara otomatis di bagian atas dasbor utama.'
        ],
        tip: 'Menetapkan target yang realistis adalah kunci untuk membangun kebiasaan belajar jangka panjang. Mulailah dari target yang kecil!'
    },
    {
        id: 'progres_saya', title: 'Progres Saya', icon: 'fa-chart-line',
        description: 'Melihat analisis mendalam dan perkembangan belajar Anda dari waktu ke waktu berdasarkan hasil Tes Mingguan.',
        steps: [
            'Fitur ini hanya akan menampilkan data setelah Anda menyelesaikan minimal satu "Tes Mingguan".',
            'Anda akan melihat grafik tren skor total Anda dari minggu ke minggu.',
            'Terdapat juga grafik rata-rata skor per bagian tes (Structure, Reading, dll.) untuk membantu Anda mengidentifikasi kelemahan.',
            'Di bagian bawah, AI akan memberikan analisis kualitatif tentang kesalahan umum yang Anda buat pada tes terakhir.'
        ],
        tip: 'Gunakan halaman ini untuk memahami di area mana Anda perlu lebih banyak berlatih.'
    }, // <-- Pastikan ada koma setelah objek 'progres_saya'
    {
        id: 'rencana_harian', title: 'Rencana Belajar Harian', icon: 'fa-tasks',
        description: 'Merancang, menyimpan, dan menjalankan urutan aktivitas belajar harian yang terstruktur dan terpandu.',
        steps: [
            'Klik kartu "Rencana Belajar Harian" di dasbor untuk masuk ke halaman "Perancang Rencana".',
            'Di kolom kiri, klik pada aktivitas yang ingin Anda tambahkan ke dalam rencana Anda. Anda bisa menambahkan aktivitas yang sama lebih dari satu kali.',
            'Susunan rencana Anda akan terlihat di kolom kanan. Setelah selesai, klik "Simpan Rencana".',
            'Di dasbor, akan muncul widget "Peta Perjalanan Belajar". Klik "Mulai Rencana Belajar" untuk memulai aktivitas pertama.',
            'Setelah menyelesaikan sebuah aktivitas, sebuah pop-up akan muncul. Pilih "Lanjutkan" untuk otomatis pindah ke aktivitas berikutnya.',
            'Pilih "Buat Catatan & Jeda" jika Anda ingin membuka panel catatan terlebih dahulu. Rencana Anda akan terjeda dan bisa dilanjutkan nanti dari dasbor.'
        ],
        tip: 'Rancang rencana Anda di awal hari untuk membangun rutinitas dan komitmen belajar yang kuat. Progres Anda akan tersimpan bahkan jika Anda menutup browser.'
    }
    // Anda bisa menambahkan panduan untuk fitur lainnya dengan format yang sama
];

function playVideoInModal(videoId) {
    const modal = document.getElementById('videoPlayerModal');
    const iframeContainer = document.getElementById('videoIframeContainer');
    const closeBtn = document.getElementById('closeVideoModalBtn');

    iframeContainer.innerHTML = `<iframe class="absolute top-0 left-0 w-full h-full rounded-md" src="https://www.youtube.com/embed/${videoId}?autoplay=1" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    modal.classList.remove('hidden');

    const closeModal = () => {
        modal.classList.add('hidden');
        iframeContainer.innerHTML = ''; // Hentikan video saat modal ditutup
    };

    closeBtn.addEventListener('click', closeModal, { once: true });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    }, { once: true });
}

function startUserGuide() {
    const guideSection = document.getElementById('userGuideSection');
    let navHtml = '<ul class="space-y-2">';
    let contentHtml = '<div class="space-y-12">';

    USER_GUIDE_CONTENT.forEach(item => {
        navHtml += `<li><a href="#guide-${item.id}" class="block p-2 rounded-md hover:bg-slate-100 text-slate-600 font-medium">${item.title}</a></li>`;
        contentHtml += `
            <div id="guide-${item.id}" class="guide-section-heading">
                <div class="flex items-center gap-3 mb-3">
                    <i class="fas ${item.icon} text-xl text-blue-600"></i>
                    <h3 class="text-2xl font-bold text-slate-800">${item.title}</h3>
                </div>
                <p class="text-slate-500 mb-4">${item.description}</p>
                <h4 class="font-semibold mb-2">Cara Penggunaan:</h4>
                <ol class="list-decimal list-inside space-y-1 text-slate-600">
                    ${item.steps.map(step => `<li>${step}</li>`).join('')}
                </ol>
                ${item.tip ? `<div class="mt-4 p-3 bg-yellow-50 border-l-4 border-yellow-400 text-sm text-yellow-800"><b>Tips:</b> ${item.tip}</div>` : ''}
            </div>
        `;
    });

    navHtml += '</ul>';
    contentHtml += '</div>';

    // --- PERUBAHAN UTAMA ADA DI SINI ---
    guideSection.innerHTML = `
        ${createSectionHeader('Panduan Pengguna')}
        <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
            <aside class="md:col-span-1 mb-8 md:mb-0 md:sticky md:top-[140px] h-fit border-b md:border-b-0 pb-6 md:pb-0">
                <h4 class="text-lg font-bold mb-3">Daftar Fitur</h4>
                ${navHtml}
            </aside>
            <main class="md:col-span-3">
                ${contentHtml}
            </main>
        </div>
    `;
    // ------------------------------------

    guideSection.querySelectorAll('a').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            document.querySelector(this.getAttribute('href')).scrollIntoView({
                behavior: 'smooth'
            });
        });
    });

    showSection('userGuideSection');
}
// --- ASK AI FEATURE (PANEL VERSION) ---

let isAiPanelInitialized = false;

const openAskAiPanel = () => {
    const aiPanel = document.getElementById('askAiPanel');
    const aiPanelContent = document.getElementById('askAiPanelContent');

    // Hanya bangun UI sekali saja untuk efisiensi
    if (!isAiPanelInitialized) {
        aiPanelContent.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-2xl font-bold">Tanya OWL</h3>
                <button id="closeAiPanelBtn" class="p-2 w-8 h-8 rounded-full hover:bg-slate-200 flex items-center justify-center">&times;</button>
            </div>
            <div id="aiChatContainer" class="flex flex-col h-[calc(100%-60px)]">
                <div id="aiChatHistory" class="flex-grow p-4 bg-slate-50 border rounded-t-lg overflow-y-auto">
                    <div class="message ai-message"><p>Hello! Ask me anything about English!</p></div>
                </div>
                <div class="p-4 bg-slate-100 border-x">
                    <p class="text-sm font-semibold mb-2 text-slate-600">Saran Pertanyaan:</p>
                    <div class="flex flex-wrap gap-2">
                        <button class="suggestion-btn">Explain "present perfect"</button>
                        <button class="suggestion-btn">Difference between "affect" and "effect"</button>
                    </div>
                </div>
                <div class="flex gap-2 p-4 bg-slate-100 border rounded-b-lg">
                    <textarea id="aiChatInput" class="block w-full rounded-md border-slate-300 shadow-sm resize-none" rows="1" placeholder="Ketik pertanyaanmu..."></textarea>
                    <button id="aiChatSendBtn" class="btn-primary flex-shrink-0 !py-2 !px-4"><i class="fas fa-paper-plane"></i></button>
                </div>
            </div>
        `;

        // --- Logika Chat (sama seperti sebelumnya, kini di dalam panel) ---
        const chatHistory = document.getElementById('aiChatHistory');
        const chatInput = document.getElementById('aiChatInput');
        const sendBtn = document.getElementById('aiChatSendBtn');
        const suggestions = aiPanel.querySelectorAll('.suggestion-btn');

        let conversationHistory = [
            // (System prompt tetap sama seperti sebelumnya)
        ];

        const addMessageToHistory = (speaker, text) => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${speaker === 'user' ? 'user-message' : 'ai-message'}`;
            messageDiv.innerHTML = markdownToHtml(text);
            chatHistory.appendChild(messageDiv);
            chatHistory.scrollTop = chatHistory.scrollHeight;
        };

        const sendAiChatMessage = async (userText) => {
            if (!userText.trim()) return;
            addMessageToHistory('user', userText);
            conversationHistory.push({ role: 'user', parts: [{ text: userText }] });
            chatInput.value = '';
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            try {
                const payload = { contents: conversationHistory };
                const result = await callGeminiAPI(payload);
                const aiResponse = result.candidates[0].content.parts[0].text;
                addMessageToHistory('ai', aiResponse);
                conversationHistory.push({ role: 'model', parts: [{ text: aiResponse }] });
            } catch (error) {
                addMessageToHistory('ai', "Maaf, terjadi kesalahan.");
            } finally {
                sendBtn.disabled = false;
                sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
            }
        };

        sendBtn.addEventListener('click', () => sendAiChatMessage(chatInput.value));
        chatInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiChatMessage(chatInput.value); }
        });
        suggestions.forEach(btn => btn.addEventListener('click', () => sendAiChatMessage(btn.textContent)));

        document.getElementById('closeAiPanelBtn').addEventListener('click', () => {
            aiPanel.classList.add('translate-x-full');
        });

        isAiPanelInitialized = true;
    }

    // Tampilkan panel
    aiPanel.classList.remove('translate-x-full');
};

// --- WRITING FEATURE ---

async function startWritingPractice() {
    sessionStorage.setItem('currentRunningActivityId', 'startWritingBtn');
    showLoading(true);
    const writingSection = document.getElementById('writingSection');
    writingSection.innerHTML = createSectionHeader('Writing the Text');
    const contentDiv = document.createElement('div');
    writingSection.appendChild(contentDiv);

    try {
        const payload = {
            contents: [{ parts: [{ text: `Generate a short, simple paragraph in Indonesian (about 3-4 sentences) on a general topic like daily activities, hobbies, or technology. The response must be a single JSON object with one key: "paragraph".` }] }],
            generationConfig: { responseMimeType: "application/json" }
        };
        const result = await callGeminiAPI(payload);
        let rawText = result.candidates[0].content.parts[0].text;
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(rawText);

        displayWritingChallenge(data.paragraph, contentDiv);
        showSection('writingSection');
    } catch (error) {
        console.error("Error generating writing prompt:", error);
        showToast("Gagal memuat tantangan menulis.", 'error');
        showSection(null);
    } finally {
        showLoading(false);
    }
}

function displayWritingChallenge(indonesianParagraph, container) {
    container.innerHTML = `
                <div class="mb-6">
                    <h4 class="font-bold mb-2 text-slate-700">Terjemahkan paragraf ini ke Bahasa Inggris:</h4>
                    <p class="p-4 bg-slate-100 rounded-md text-slate-800 italic">"${indonesianParagraph}"</p>
                </div>
                <div>
                    <label for="writingInput" class="block text-sm font-medium text-slate-700">Jawaban Anda:</label>
                    <textarea id="writingInput" rows="6" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" placeholder="Tulis terjemahan Anda di sini..."></textarea>
                </div>
                <div class="flex justify-end mt-6">
                    <button id="submitWritingBtn" class="btn-primary">Periksa Jawaban</button>
                </div>
            `;

    document.getElementById('submitWritingBtn').addEventListener('click', () => {
        const translation = document.getElementById('writingInput').value.trim();
        if (!translation) {
            showToast("Harap tulis terjemahan Anda.", "error");
            return;
        }
        reviewWritingSubmission(indonesianParagraph, translation, container);
    });
}

async function reviewWritingSubmission(originalText, userTranslation, container) {
    showLoading(true, "AI sedang memeriksa tulisan Anda...");
    try {
        const payload = {
            contents: [{
                parts: [{
                    text: `You are an English teacher reviewing a student's translation.
                    Original Indonesian: "${originalText}"
                    Student's English Translation: "${userTranslation}"

                    Provide feedback in Indonesian. Format the response as a single JSON object with four keys:
                    1. "correct_translation": A string with a natural, correct English translation of the original paragraph.
                    2. "correction": A string showing the student's translation with corrections. Use <u> for additions and <del> for deletions. If it's perfect, return the original translation.
                    3. "feedback": A string containing an HTML unordered list (<ul><li>...</li></ul>) explaining the mistakes (grammar, vocabulary, phrasing) point-by-point.
                    4. "recommendation": A brief, encouraging recommendation for improvement.` }]
            }],
            generationConfig: { responseMimeType: "application/json" }
        };

        const result = await callGeminiAPI(payload);
        let rawText = result.candidates[0].content.parts[0].text;
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const feedbackData = JSON.parse(rawText);

        displayWritingFeedback(originalText, userTranslation, feedbackData, container);

    } catch (error) {
        console.error("Error reviewing writing:", error);
        showToast("Gagal memeriksa tulisan Anda.", 'error');
    } finally {
        showLoading(false);
    }
    handleEndOfActivity();
}

function displayWritingFeedback(original, translation, feedback, container) {
    addXP(40);
    updateUserStat('writingExercises');
    container.innerHTML = `
                <div>
                    <div class="mb-6">
                        <h4 class="font-bold text-slate-700">Paragraf Asli (Indonesia)</h4>
                        <p class="p-3 bg-slate-100 rounded-md text-sm italic">"${original}"</p>
                    </div>
                    <div class="mb-6">
                        <h4 class="font-bold text-slate-700">Jawaban Anda</h4>
                        <p class="p-3 bg-red-50 rounded-md text-sm">"${translation}"</p>
                    </div>
                    <div class="mb-6">
                        <h4 class="font-bold text-slate-700">Versi yang Dikoreksi</h4>
                        <p class="p-3 bg-orange-50 rounded-md text-sm">${feedback.correction}</p>
                    </div>
                     <div class="mb-6">
                        <h4 class="font-bold text-slate-700">Contoh Jawaban Benar</h4>
                        <p class="p-3 bg-green-50 rounded-md text-sm">${feedback.correct_translation}</p>
                    </div>
                     <div class="mb-6">
                        <h4 class="font-bold text-slate-700">Pembahasan</h4>
                        <div class="p-3 bg-blue-50 rounded-md text-sm prose max-w-none">${feedback.feedback}</div>
                    </div>
                    <div class="mb-6">
                        <h4 class="font-bold text-slate-700">Rekomendasi</h4>
                        <p class="p-3 bg-yellow-50 rounded-md text-sm italic">"${feedback.recommendation}"</p>
                    </div>
                    <div class="flex justify-end mt-8">
                        <button id="tryAnotherWritingBtn" class="btn-primary">Coba Paragraf Lain</button>
                    </div>
                </div>
            `;

    document.getElementById('tryAnotherWritingBtn').addEventListener('click', startWritingPractice);
    handleEndOfActivity();
}

function startExcelPractice() {
    const excelSection = document.getElementById('excelSection');
    excelSection.innerHTML = createSectionHeader('Latihan Excel') + `
                <div class="text-center">
                    <p class="text-slate-600 mb-4">Fitur Latihan Excel sedang dalam pengembangan.</p>
                    <i class="fas fa-tools text-4xl text-slate-300"></i>
                </div>
            `;
    showSection('excelSection');
}


// --- GAMIFICATION STATE & CONFIG ---
let userProfile = { xp: 0, level: 1 };
let userStats = {
    dailyPractices: 0,
    flashcardsCreated: 0,
    weeklyTests: 0,
    booksRead: 0,
    listeningSessions: 0,
    writingExercises: 0,
    vocabTests: 0,
};
let userBadges = [];

const ALL_BADGES = [
    { id: 'daily_1', name: 'Pejuang Harian', description: 'Selesaikan 1 Latihan Harian.', icon: 'fa-pencil-alt', criteria: (stats) => stats.dailyPractices >= 1 },
    { id: 'daily_10', name: 'Rajin Harian', description: 'Selesaikan 10 Latihan Harian.', icon: 'fa-award', criteria: (stats) => stats.dailyPractices >= 10 },
    { id: 'flashcard_5', name: 'Kolektor Kata', description: 'Buat 5 flashcard baru.', icon: 'fa-layer-group', criteria: (stats) => stats.flashcardsCreated >= 5 },
    { id: 'level_5', name: 'Level Up!', description: 'Capai Level 5.', icon: 'fa-star', criteria: (stats, profile) => profile.level >= 5 },
];

function loadGamificationData() {
    userProfile = JSON.parse(localStorage.getItem('userProfile')) || { xp: 0, level: 1 };
    userStats = JSON.parse(localStorage.getItem('userStats')) || { dailyPractices: 0, flashcardsCreated: 0, weeklyTests: 0 };
    userBadges = JSON.parse(localStorage.getItem('userBadges')) || [];
}

const XP_FOR_LEVEL = 150; // XP yang dibutuhkan per level

function updateXpDisplay() {
    const xpLevelElement = document.getElementById('xpLevel');
    const xpTextElement = document.getElementById('xpText');
    const xpBarElement = document.getElementById('xpBar');

    if (!xpLevelElement || !xpTextElement || !xpBarElement) return; // Pengaman jika elemen tidak ditemukan

    const xpForPreviousLevels = (userProfile.level - 1) * XP_FOR_LEVEL;
    const currentLevelXp = userProfile.xp - xpForPreviousLevels;
    const percentage = (currentLevelXp / XP_FOR_LEVEL) * 100;

    // Perbarui semua elemen UI
    xpLevelElement.textContent = userProfile.level;
    xpTextElement.textContent = `${currentLevelXp} / ${XP_FOR_LEVEL} XP`;
    xpBarElement.style.width = `${Math.min(100, percentage)}%`;
}

function addXP(amount) {
    userProfile.xp += amount;
    showToast(`+${amount} XP!`, 'success');

    const xpForNextLevel = userProfile.level * XP_FOR_LEVEL;
    if (userProfile.xp >= xpForNextLevel) {
        userProfile.level++;
        showToast(`🎉 Selamat! Anda naik ke Level ${userProfile.level}!`, 'success');
    }

    localStorage.setItem('userProfile', JSON.stringify(userProfile));
    updateXpDisplay();
    checkAndAwardBadges();
}

function updateUserStat(statKey, amount = 1) {
    userStats[statKey] = (userStats[statKey] || 0) + amount;
    localStorage.setItem('userStats', JSON.stringify(userStats));
    checkAndAwardBadges();
}

function checkAndAwardBadges() {
    ALL_BADGES.forEach(badge => {
        if (!userBadges.includes(badge.id) && badge.criteria(userStats, userProfile)) {
            userBadges.push(badge.id);
            localStorage.setItem('userBadges', JSON.stringify(userBadges));
            showToast(`🏅 Lencana Terbuka: ${badge.name}!`, 'success');
        }
    });
}

function startBadgesPage() {
    const section = document.getElementById('badgesSection');
    let html = `${createSectionHeader('Lencana & Prestasi')}
                <div class="grid grid-cols-2 md:grid-cols-4 gap-6">`;

    ALL_BADGES.forEach(badge => {
        const isUnlocked = userBadges.includes(badge.id);
        html += `
            <div class="border rounded-lg p-4 text-center ${isUnlocked ? 'bg-yellow-50' : 'bg-slate-50 opacity-60'}">
                <i class="fas ${badge.icon} text-4xl ${isUnlocked ? 'text-yellow-500' : 'text-slate-400'}"></i>
                <h4 class="font-bold mt-3">${badge.name}</h4>
                <p class="text-xs text-slate-500 mt-1">${badge.description}</p>
            </div>
        `;
    });

    html += `</div>`;
    section.innerHTML = html;
    showSection('badgesSection');
}

// --- INITIALIZATION ---
function initApp() {
    loadGamificationData();
    updateXpDisplay();
    checkAndResetDailyPlan();
    showLoading(true);

    const lastSeenVersion = localStorage.getItem('lastSeenVersion');
    if (appVersion !== lastSeenVersion) {
        document.getElementById('updateModal').classList.remove('hidden');
        document.getElementById('closeUpdateModalBtn').addEventListener('click', () => {
            document.getElementById('updateModal').classList.add('hidden');
            localStorage.setItem('lastSeenVersion', appVersion);
        });
    }

    apiKey = localStorage.getItem('geminiApiKey') || "";

    // Tampilkan peringatan jika API Key kosong
    const apiKeyWarning = document.getElementById('apiKeyWarning');
    if (!apiKey) {
        apiKeyWarning.classList.remove('hidden');
        apiKeyWarning.querySelector('#settingsLink').addEventListener('click', (e) => {
            e.preventDefault();
            manageSettings();
        });
    } else {
        apiKeyWarning.classList.add('hidden');
    }

    loadFlashcards();
    loadNotes();
    checkForReviews();
    updateDashboardDisplay();

    document.body.addEventListener('click', (e) => {
        const target = e.target.closest('.dashboard-card, .back-to-dash-btn, #startReviewBtn, #openNotesBtn, #openAskAiBtn, #setGoalsFromSummaryBtn');
        if (!target) return;

        const id = target.id;
        if (id === 'startDailyPracticeBtn') startDailyPractice();
        else if (id === 'startWeeklyTestBtn') startWeeklyTest();
        else if (id === 'startListeningBtn') startListeningPractice();
        else if (id === 'manageFlashcardsBtn') manageFlashcards();
        else if (id === 'startSpeakingBtn') startSpeakingHelper();
        else if (id === 'startReviewBtn') startReviewSession();
        else if (id === 'manageGoalsBtn' || id === 'setGoalsFromSummaryBtn') manageGoals();
        else if (id === 'startBookSummaryBtn') startBookSummary();
        else if (id === 'startGrammarGuideBtn') startGrammarGuide();
        else if (id === 'startAskAiBtn') startAskAi();
        else if (id === 'openNotesBtn') manageNotes();
        else if (id === 'closeInstructionModalBtn') document.getElementById('testInstructionsModal').classList.add('hidden');
        else if (target.classList.contains('back-to-dash-btn')) showSection(null);
        else if (id === 'startPlanBuilderBtn') startPlanBuilder();
        else if (id === 'openAskAiBtn') openAskAiPanel();
        else if (id === 'startMindMapBtn') startMindMapFeature();
        else if (id === 'startUserGuideBtn') startUserGuide();
        else if (id === 'startBadgesBtn') startBadgesPage();
    });


    document.getElementById('levelInfoBtn').addEventListener('click', () => {
        document.getElementById('levelInfoModal').classList.remove('hidden');
    });
    document.getElementById('closeLevelInfoBtn').addEventListener('click', () => {
        document.getElementById('levelInfoModal').classList.add('hidden');
    });

    document.getElementById('viewProgressBtn').addEventListener('click', viewProgress);

    document.body.addEventListener('click', (e) => {
        if (!e.target.closest('#translationTooltip') && !e.target.closest('#translateSelectionBtn') && !e.target.classList.contains('translatable-word')) {
            translationTooltip.classList.add('hidden');
        }
        if (e.target.id === 'startPlanBuilderBtn') startPlanBuilder();
    });

    // Listeners for Test Instruction Modal
    document.getElementById('closeInstructionModalBtn').addEventListener('click', () => {
        document.getElementById('testInstructionsModal').classList.add('hidden');
    });
    document.getElementById('testInstructionsModalBackdrop').addEventListener('click', () => {
        document.getElementById('testInstructionsModal').classList.add('hidden');
    });

    document.getElementById('weeklyTestInfoBtn').addEventListener('click', (e) => {
        e.stopPropagation(); // Mencegah card di belakangnya ikut ter-klik
        showTestInstructions('All');
    });

    document.getElementById('startWritingBtn').addEventListener('click', startWritingPractice);
    document.getElementById('settingsBtn').addEventListener('click', manageSettings);

    featureContainer.addEventListener('click', async (e) => {
        if (e.target.classList.contains('translatable-word') && window.getSelection().toString().length === 0) {
            e.stopPropagation();
            const word = e.target.textContent.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim();

            if (!word) return;

            const rect = e.target.getBoundingClientRect();
            translationTooltip.style.left = `${window.scrollX + rect.left + rect.width / 2}px`;
            translationTooltip.style.top = `${window.scrollY + rect.top - 8}px`;
            translationTooltip.style.transform = 'translateX(-50%) translateY(-100%)';
            translationTooltip.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            translationTooltip.classList.remove('hidden');

            try {
                const payload = {
                    contents: [{ parts: [{ text: `Provide only the single, most common Indonesian translation for the English word: "${word}". Do not include any explanation, examples, or markdown formatting.` }] }]
                };
                const result = await callGeminiAPI(payload);
                const translation = result.candidates[0].content.parts[0].text.replace(/[\"*\n]/g, "").trim();
                translationTooltip.textContent = translation;
            } catch (error) {
                console.error("Translation error:", error);
                translationTooltip.textContent = 'Error';
            }
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (e.target.closest('#translateSelectionBtn') || e.target.closest('#addFlashcardSelectionBtn') || e.target.closest('#notesPanel')) {
            return;
        }

        setTimeout(() => {
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();

            if (selectedText.length > 0 && selection.anchorNode.parentElement.closest('#summaryTextContainer')) {
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                const addFlashcardBtn = document.getElementById('addFlashcardSelectionBtn');

                // Atur posisi tombol terjemahan
                translateSelectionBtn.style.left = `${window.scrollX + rect.right + 10}px`;
                translateSelectionBtn.style.top = `${window.scrollY + rect.top + (rect.height / 2) - 22}px`; // Geser ke atas
                translateSelectionBtn.style.transform = 'translateY(-50%)';

                // Atur posisi tombol flashcard
                addFlashcardBtn.style.left = `${window.scrollX + rect.right + 10}px`;
                addFlashcardBtn.style.top = `${window.scrollY + rect.top + (rect.height / 2) + 22}px`; // Geser ke bawah
                addFlashcardBtn.style.transform = 'translateY(-50%)';

                translateSelectionBtn.classList.remove('hidden');
                addFlashcardBtn.classList.remove('hidden');
            } else {
                translateSelectionBtn.classList.add('hidden');
                document.getElementById('addFlashcardSelectionBtn').classList.add('hidden');
            }
        }, 10);
    });
    document.getElementById('startVocabTestBtn').addEventListener('click', startVocabTest);

    translateSelectionBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const selectedText = window.getSelection().toString().trim();
        if (!selectedText) return;

        const rect = e.currentTarget.getBoundingClientRect();
        translationTooltip.style.left = `${window.scrollX + rect.left}px`;
        translationTooltip.style.top = `${window.scrollY + rect.top - 8}px`;
        translationTooltip.style.transform = 'translateX(-100%) translateY(-50%)';
        translationTooltip.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        translationTooltip.classList.remove('hidden');

        try {
            const payload = {
                contents: [{ parts: [{ text: `Translate the following English text to Indonesian: "${selectedText}". Provide only the translation without any extra formatting.` }] }]
            };
            const result = await callGeminiAPI(payload);
            const translation = result.candidates[0].content.parts[0].text.replace(/[\"*\n]/g, "").trim();
            translationTooltip.textContent = translation;
        } catch (error) {
            console.error("Translation error:", error);
            translationTooltip.textContent = 'Error';
        } finally {
            translateSelectionBtn.classList.add('hidden');
        }
    });

    // --- Dynamic Greeting Owl Logic ---
    const initDynamicGreeting = () => {
        const greetingTextElement = document.getElementById('greetingText');

        const messages = [
            "Hello! Welcome to English Everyday.",
            "Believe you can and you're halfway there. Let's study!",
            "The secret of getting ahead is getting started.",
            "Did you know? 'Bookkeeper' has three consecutive double letters.",
            "A little progress each day adds up to big results.",
            "The journey of a thousand miles begins with a single step.",
            "Don't stop until you're proud. Let's learn something new!"
        ];

        let messageIndex = 0;
        let isTyping = false;

        // Fungsi untuk membuat animasi ketik
        const typeMessage = async (message) => {
            if (isTyping) return; // Mencegah animasi baru jika yang lama masih berjalan
            isTyping = true;
            greetingTextElement.classList.add('typing-effect');
            greetingTextElement.textContent = '"';

            for (let i = 0; i < message.length; i++) {
                await new Promise(resolve => setTimeout(resolve, 50)); // Jeda antar karakter
                greetingTextElement.textContent += message[i];
            }

            greetingTextElement.textContent += '"';
            greetingTextElement.classList.remove('typing-effect');
            isTyping = false;
        };

        // Fungsi untuk memulai siklus pesan
        const startMessageCycle = () => {
            // Tampilkan pesan pertama segera
            typeMessage(messages[messageIndex]);
            messageIndex = (messageIndex + 1) % messages.length;

            // Atur interval untuk pesan-pesan selanjutnya
            setInterval(() => {
                typeMessage(messages[messageIndex]);
                messageIndex = (messageIndex + 1) % messages.length;
            }, 10000); // 10 detik
        };

        startMessageCycle();
    };

    initDynamicGreeting(); // Panggil fungsi ini di dalam initApp

    // --- PWA Service Worker Registration ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(registration => {
                    console.log('ServiceWorker registration successful with scope: ', registration.scope);
                })
                .catch(err => {
                    console.log('ServiceWorker registration failed: ', err);
                });
        });
    }

    const dailyNotificationBtn = document.getElementById('dailyNotificationBtn');
    dailyNotificationBtn.addEventListener('click', setupDailyNotification);

    const initPomodoro = () => {
        const timeDisplay = document.getElementById('pomoTime');
        const startPauseBtn = document.getElementById('pomoStartPause');
        const startPauseIcon = startPauseBtn.querySelector('i');
        const settingsBtn = document.getElementById('pomoSettingsBtn');
        const settingsModal = document.getElementById('pomodoroSettingsModal');
        const saveSettingsBtn = document.getElementById('savePomodoroSettingsBtn');
        const alarmSound = document.getElementById('pomodoroAlarm');
        const modeLabel = document.getElementById('pomoModeLabel');

        let settings = {};
        let timerInterval = null;
        let currentMode = 'pomodoro';
        let timeLeft = 0;
        let isPaused = true;
        let currentRound = 0;

        const loadSettings = () => {
            const savedSettings = JSON.parse(localStorage.getItem('pomodoroSettings'));
            settings = {
                pomodoro: savedSettings?.pomodoro || 25,
                shortBreak: savedSettings?.shortBreak || 5,
                longBreak: savedSettings?.longBreak || 15,
                rounds: savedSettings?.rounds || 4,
            };
            // Perbarui tampilan input di modal
            document.getElementById('pomoMinutes').value = settings.pomodoro;
            document.getElementById('pomoShortBreak').value = settings.shortBreak;
            document.getElementById('pomoLongBreak').value = settings.longBreak;
            document.getElementById('pomoRounds').value = settings.rounds;
        };

        const updateDisplay = () => {
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            timeDisplay.textContent = formattedTime;
            document.title = `${formattedTime} - ${currentMode}`;
        };


        const switchMode = (mode) => {
            clearInterval(timerInterval);
            timerInterval = null;
            currentMode = mode;
            timeLeft = (settings[mode] || 25) * 60;
            isPaused = true;
            startPauseIcon.classList.replace('fa-pause', 'fa-play');

            // Hapus logika warna dan ganti dengan ini
            if (mode === 'pomodoro') {
                modeLabel.textContent = 'Mode Fokus';
            } else {
                modeLabel.textContent = 'Mode Istirahat';
            }

            updateDisplay();
        };

        const startTimer = () => {
            isPaused = false;
            startPauseIcon.classList.replace('fa-play', 'fa-pause');

            timerInterval = setInterval(() => {
                timeLeft--;
                updateDisplay();
                if (timeLeft <= 0) {
                    clearInterval(timerInterval);
                    alarmSound.play();

                    if (currentMode === 'pomodoro') {
                        currentRound++;
                        if (currentRound % settings.rounds === 0) {
                            switchMode('longBreak');
                        } else {
                            switchMode('shortBreak');
                        }
                    } else {
                        switchMode('pomodoro');
                    }
                }
            }, 1000);
        };

        const pauseTimer = () => {
            clearInterval(timerInterval);
            isPaused = true;
            startPauseIcon.classList.replace('fa-pause', 'fa-play');
        };

        // Event Listeners
        startPauseBtn.addEventListener('click', () => isPaused ? startTimer() : pauseTimer());

        settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));

        saveSettingsBtn.addEventListener('click', () => {
            settings.pomodoro = parseInt(document.getElementById('pomoMinutes').value) || 25;
            settings.shortBreak = parseInt(document.getElementById('pomoShortBreak').value) || 5;
            settings.longBreak = parseInt(document.getElementById('pomoLongBreak').value) || 15;
            settings.rounds = parseInt(document.getElementById('pomoRounds').value) || 4;
            localStorage.setItem('pomodoroSettings', JSON.stringify(settings));
            settingsModal.classList.add('hidden');
            switchMode('pomodoro'); // Reset ke mode awal dengan pengaturan baru
            showToast("Pengaturan Pomodoro disimpan!");
        });

        // Klik di luar modal untuk menutup
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.add('hidden');
            }
        });

        // Inisialisasi
        loadSettings();
        switchMode('pomodoro');
    };

    initPomodoro(); // Panggil fungsi ini
    updateNotificationIconState(); // Atur status ikon saat aplikasi dimuat

    showLoading(false);
}

window.addEventListener('load', initApp);
