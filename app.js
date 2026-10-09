// =========================================================
// ⚙️ CONFIGURAÇÕES
// =========================================================
const CONFIG = {
    playlistUrl: 'https://dblpl.s3.us-east-1.amazonaws.com/TV-Corporativa/playlist.json',            // ex.: 'playlist.json' (JSON). null = usa PLAYLIST_PADRAO
    atualizarPlaylistMin: 5,
    transicaoMs: 1500,
    duracaoPadraoImagemSeg: 10,
    timeoutCarregamentoMs: 20000,
    reiniciarPaginaAs: null,   // manter a tela ligada sem reinício automático

    // Clima (Open-Meteo, gratuito e sem chave)
    cidade: 'Vargem Grande Paulista',
    latitude: -23.5997,
    longitude: -47.0233,
    atualizarClimaMin: 15,

    // Aniversariantes: CSV local do projeto. null = usa só o CSV enviado pelo botão ⬆ / tecla U
    aniversariantesUrl: './aniversariantes_outubro.csv',
    atualizarAnivMin: 30
};

// =========================================================
// 🎬 PLAYLIST
// tipo: 'image' | 'video' | url | duracao (seg) | ajuste: 'contain' (padrão) ou 'cover'
// dataInicio / dataFim (opcionais): 'DD/MM/AAAA HH:MM:SS'
// =========================================================
const PLAYLIST_PADRAO = [
    {
        tipo: 'image',
        url: 'https://dblpl.s3.us-east-1.amazonaws.com/TV-Corporativa/Aviso+Sala+Reuni%C3%A3o.png'
    },
    {
        tipo: 'video',
        url: 'https://dblpl.s3.us-east-1.amazonaws.com/TV-Corporativa/RH+-+V%C3%ADdeo+.mp4'
    },
    {
        tipo: 'video',
        url: 'https://dblpl.s3.us-east-1.amazonaws.com/TV-Corporativa/Outubro+Rosa.mp4',
        duracao: 30,
        dataInicio: '29/09/2026 15:10:00',
        dataFim: '09/10/2026 18:15:00'
    },
    {
        tipo: 'video',
        url: 'https://dblpl.s3.us-east-1.amazonaws.com/TV-Corporativa/Plant%C3%A3o+de+D%C3%BAvidas.mp4',
        duracao: 40,
        dataInicio: '29/09/2026 15:10:00',
        dataFim: '09/10/2026 18:15:00'
    },
    {
        tipo: 'video',
        url: 'https://dblpl.s3.us-east-1.amazonaws.com/TV-Corporativa/Novos+Brigadistas+(1).mp4',
        duracao: 20,
        dataInicio: '29/09/2026 15:10:00',
        dataFim: '09/10/2026 18:15:00'
    }
];

// =========================================================
// 🔧 LÓGICA DA PLAYLIST
// =========================================================
const $ = id => document.getElementById(id);
const container = $('media-container');
const RECHECAGEM_UNICA_MS = 30000;

let playlist = PLAYLIST_PADRAO;
let indexAtual = -1, elementoAtual = null, timer = null, geracao = 0;
let wakeLock = null, iniciada = false;

document.documentElement.style.setProperty('--transicao', CONFIG.transicaoMs + 'ms');

function converterDataBR(str) {
    if (!str) return null;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(str).trim());
    if (!m) { console.warn('Data inválida (use DD/MM/AAAA HH:MM:SS):', str); return null; }
    const [, dia, mes, ano, h = 0, min = 0, seg = 0] = m;
    return new Date(+ano, +mes - 1, +dia, +h, +min, +seg);
}

function estaNoPeriodo(media, agora) {
    const inicio = converterDataBR(media.dataInicio), fim = converterDataBR(media.dataFim);
    if (inicio && inicio > agora) return false;
    if (fim && fim < agora) return false;
    return true;
}

function itemValido(m) {
    return m && (m.tipo === 'image' || m.tipo === 'video') && typeof m.url === 'string';
}

function listarValidos() {
    const agora = new Date(), validos = [];
    playlist.forEach((m, i) => { if (itemValido(m) && estaNoPeriodo(m, agora)) validos.push(i); });
    return validos;
}

function proximoIndice(atual, validos) {
    if (!validos.length) return -1;
    const seguinte = validos.find(i => i > atual);
    return seguinte !== undefined ? seguinte : validos[0];
}

function carregarMedia(media) {
    return new Promise((resolve, reject) => {
        const el = document.createElement(media.tipo === 'video' ? 'video' : 'img');
        el.className = 'media-item';
        if (media.ajuste === 'cover') el.style.objectFit = 'cover';

        const t = setTimeout(() => reject(new Error('Tempo esgotado: ' + media.url)), CONFIG.timeoutCarregamentoMs);
        const ok = () => { clearTimeout(t); resolve(el); };
        el.onerror = () => { clearTimeout(t); reject(new Error('Falha ao carregar: ' + media.url)); };

        if (media.tipo === 'video') {
            el.muted = true; el.playsInline = true; el.preload = 'auto';
            el.onloadeddata = ok;
        } else {
            el.decoding = 'async'; el.alt = ''; el.onload = ok;
        }
        el.src = media.url;
    });
}

function descartar(el) {
    if (!el) return;
    if (el.tagName === 'VIDEO') { el.pause(); el.removeAttribute('src'); el.load(); }
    el.remove();
}

function limparTela() {
    const antigo = elementoAtual;
    elementoAtual = null;
    $('vazio').classList.add('on');
    if (antigo) {
        antigo.classList.remove('active');
        setTimeout(() => descartar(antigo), CONFIG.transicaoMs + 100);
    }
}

function exibir(el) {
    const antigo = elementoAtual;
    elementoAtual = el;
    $('vazio').classList.remove('on');
    container.appendChild(el);
    void el.offsetWidth;

    if (el.tagName === 'VIDEO') el.play().catch(err => console.warn('Não foi possível reproduzir o vídeo:', err));
    el.classList.add('active');

    if (antigo) {
        antigo.classList.remove('active');
        setTimeout(() => descartar(antigo), CONFIG.transicaoMs + 100);
    }
}

async function tocarProximo() {
    clearTimeout(timer);
    const minhaGeracao = ++geracao;
    const validos = listarValidos();
    const idx = proximoIndice(indexAtual, validos);

    if (idx === -1) {
        limparTela();
        indexAtual = -1;
        timer = setTimeout(tocarProximo, 5000);
        return;
    }

    if (validos.length === 1 && idx === indexAtual && elementoAtual) {
        timer = setTimeout(tocarProximo, RECHECAGEM_UNICA_MS);
        return;
    }

    const media = playlist[idx];
    let el;
    try {
        el = await carregarMedia(media);
    } catch (err) {
        console.error(err);
        if (minhaGeracao !== geracao) return;
        indexAtual = idx;
        timer = setTimeout(tocarProximo, 3000);
        return;
    }
    if (minhaGeracao !== geracao) { descartar(el); return; }

    indexAtual = idx;
    exibir(el);
    agendarTroca(media, el, validos.length === 1);
}

function agendarTroca(media, el, itemUnico) {
    const duracaoMs = media.duracao > 0 ? media.duracao * 1000 : null;
    const passar = () => {
        clearTimeout(timer);
        tocarProximo();
    };

    if (itemUnico) {
        if (media.tipo === 'video') el.loop = true;
        timer = setTimeout(passar, RECHECAGEM_UNICA_MS);
        return;
    }

    if (media.tipo === 'video') {
        el.loop = false;
        if (duracaoMs) {
            timer = setTimeout(passar, duracaoMs);
            return;
        }

        el.onended = () => {
            el.onended = null;
            passar();
        };
        const limite = (Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 300) * 1000 + 15000;
        timer = setTimeout(passar, limite);
        return;
    }

    timer = setTimeout(passar, duracaoMs || CONFIG.duracaoPadraoImagemSeg * 1000);
}

function pular() { if (iniciada) tocarProximo(); }

async function atualizarPlaylist() {
    if (!CONFIG.playlistUrl) return;
    try {
        const resp = await fetch(CONFIG.playlistUrl, { cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const nova = await resp.json();
        if (!Array.isArray(nova)) throw new Error('A playlist precisa ser uma lista (array)');
        if (JSON.stringify(nova) !== JSON.stringify(playlist)) {
            playlist = nova; indexAtual = -1;
            if (iniciada) tocarProximo();
        }
    } catch (err) { console.warn('Não foi possível atualizar a playlist, mantendo a atual:', err); }
}

// =========================================================
// 🕒 RELÓGIO E DATA
// =========================================================
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const DIAS = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
const pad = n => String(n).padStart(2, '0');

function atualizarRelogio() {
    const d = new Date();
    $('relogio').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    const dia = DIAS[d.getDay()];
    $('data').textContent = dia.charAt(0).toUpperCase() + dia.slice(1) + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()];
}

// =========================================================
// 🌦️ CLIMA (Open-Meteo)
// =========================================================
function descreverClima(c) {
    if (c === 0) return ['Céu limpo', '☀️'];
    if (c <= 2) return ['Parcialmente nublado', '⛅'];
    if (c === 3) return ['Nublado', '☁️'];
    if (c === 45 || c === 48) return ['Neblina', '🌫️'];
    if (c >= 51 && c <= 57) return ['Garoa', '🌦️'];
    if (c >= 61 && c <= 67) return ['Chuva', '🌧️'];
    if (c >= 71 && c <= 77) return ['Neve', '❄️'];
    if (c >= 80 && c <= 82) return ['Pancadas de chuva', '🌧️'];
    if (c >= 95) return ['Tempestade', '⛈️'];
    return ['—', '⛅'];
}

async function atualizarClima() {
    try {
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + CONFIG.latitude +
            '&longitude=' + CONFIG.longitude +
            '&current=temperature_2m,weather_code,wind_speed_10m' +
            '&daily=temperature_2m_max,temperature_2m_min&timezone=America%2FSao_Paulo';
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const j = await resp.json();
        const [desc, icone] = descreverClima(j.current.weather_code);
        $('clima-temp').textContent = Math.round(j.current.temperature_2m) + '°';
        $('clima-desc').textContent = desc;
        $('clima-icone').textContent = icone;
        $('clima-extra').innerHTML = 'Máx ' + Math.round(j.daily.temperature_2m_max[0]) + '° · Mín ' +
            Math.round(j.daily.temperature_2m_min[0]) + '°<br>Vento ' + Math.round(j.current.wind_speed_10m) + ' km/h';
    } catch (err) { console.warn('Clima indisponível, mantendo o último valor:', err); }
}

// =========================================================
// 🎂 ANIVERSARIANTES (CSV)
// Formato: nome;data;setor   (setor é opcional; separador "," ou ";")
// Data aceita: DD/MM, DD/MM/AAAA ou AAAA-MM-DD. Linha de cabeçalho é ignorada.
// =========================================================
const CHAVE_CSV = 'tv-aniversariantes';
let aniversariantes = [];

function lerArmazenado() { try { return localStorage.getItem(CHAVE_CSV) || ''; } catch (e) { return ''; } }

function parseCSV(texto) {
    const linhas = texto.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
    if (!linhas.length) return [];
    const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';
    const lista = [];
    linhas.forEach(linha => {
        const cels = linha.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
        let dia = 0, mes = 0, iData = -1;
        cels.forEach((c, i) => {
            if (iData !== -1) return;
            let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(c);
            if (m) { dia = +m[3]; mes = +m[2]; iData = i; return; }
            m = /^(\d{1,2})[\/-](\d{1,2})(?:[\/-]\d{2,4})?$/.exec(c);
            if (m) { dia = +m[1]; mes = +m[2]; iData = i; }
        });
        if (iData === -1 || dia < 1 || dia > 31 || mes < 1 || mes > 12) return;
        const outros = cels.filter((c, i) => i !== iData && c);
        if (!outros.length) return;
        lista.push({ nome: outros[0], setor: outros[1] || '', dia, mes });
    });
    return lista;
}

function renderAniversariantes() {
    const hoje = new Date(), mes = hoje.getMonth() + 1;
    $('aniv-titulo').textContent = 'Aniversariantes de ' + MESES[mes - 1];
    const lista = $('lista-aniv');
    lista.innerHTML = '';
    lista.scrollTop = 0;

    const doMes = aniversariantes.filter(a => a.mes === mes).sort((a, b) => a.dia - b.dia || a.nome.localeCompare(b.nome));
    if (!doMes.length) {
        const p = document.createElement('div');
        p.className = 'vazio-aniv';
        p.textContent = 'Nenhum aniversariante cadastrado.';
        lista.appendChild(p);
        return;
    }
    doMes.forEach(a => {
        const item = document.createElement('div');
        item.className = 'aniv-item' + (a.dia === hoje.getDate() ? ' hoje' : a.dia < hoje.getDate() ? ' passou' : '');
        const dia = document.createElement('div'); dia.className = 'aniv-dia'; dia.textContent = pad(a.dia);
        const info = document.createElement('div');
        const nome = document.createElement('div'); nome.className = 'aniv-nome';
        nome.textContent = a.nome + (a.dia === hoje.getDate() ? ' 🎉' : '');
        info.appendChild(nome);
        if (a.setor) {
            const s = document.createElement('div'); s.className = 'aniv-setor'; s.textContent = a.setor;
            info.appendChild(s);
        }
        item.appendChild(dia); item.appendChild(info);
        lista.appendChild(item);
    });
}

async function carregarAniversariantes() {
    let texto = '';
    if (CONFIG.aniversariantesUrl) {
        try {
            const resp = await fetch(CONFIG.aniversariantesUrl, { cache: 'no-store' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            texto = await resp.text();
        } catch (err) { console.warn('CSV remoto indisponível, usando o último enviado:', err); }
    }
    if (!texto) texto = lerArmazenado();
    aniversariantes = parseCSV(texto);
    renderAniversariantes();
}

let rolagem = null;
function iniciarRolagem() {
    const el = $('lista-aniv');
    let pausa = 120; // 6s iniciais parados antes da rolagem começar
    let dir = 1;
    clearInterval(rolagem);
    rolagem = setInterval(() => {
        if (el.scrollHeight <= el.clientHeight + 2) return;
        if (pausa > 0) { pausa--; return; }
        el.scrollTop += dir;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1 || el.scrollTop <= 0) {
            dir = -dir;
            pausa = 60; // pausa no fim/início da lista
        }
    }, 50);
}

function enviarCSV(arquivo) {
    if (!arquivo) return;
    const leitor = new FileReader();
    leitor.onload = () => {
        let texto;
        try { texto = new TextDecoder('utf-8', { fatal: true }).decode(leitor.result); }
        catch (e) { texto = new TextDecoder('windows-1252').decode(leitor.result); }
        try { localStorage.setItem(CHAVE_CSV, texto); } catch (e) { console.warn('Não foi possível salvar o CSV:', e); }
        aniversariantes = parseCSV(texto);
        renderAniversariantes();
    };
    leitor.readAsArrayBuffer(arquivo);
}

$('btn-csv').addEventListener('click', () => $('arquivo-csv').click());
$('arquivo-csv').addEventListener('change', e => { enviarCSV(e.target.files[0]); e.target.value = ''; });

// =========================================================
// 🖥️ Tela ligada / reinício diário / início
// =========================================================
async function manterTelaLigada() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); }
    catch (err) { console.log('Wake Lock indisponível:', err); }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && iniciada) manterTelaLigada();
});

function agendarReinicioDiario() {
    if (!CONFIG.reiniciarPaginaAs) return;
    const [h, m] = CONFIG.reiniciarPaginaAs.split(':').map(Number);
    const alvo = new Date();
    alvo.setHours(h, m, 0, 0);
    if (alvo <= new Date()) alvo.setDate(alvo.getDate() + 1);
    setTimeout(() => {
        try { sessionStorage.setItem('tv-auto', '1'); } catch (e) {}
        location.reload();
    }, alvo - new Date());
}

function iniciarTV() {
    if (iniciada) return;
    iniciada = true;

    $('start-screen').style.display = 'none';
    $('tv-display').classList.add('on');

    const raiz = document.documentElement;
    if (raiz.requestFullscreen && !document.fullscreenElement) raiz.requestFullscreen().catch(() => {});

    manterTelaLigada();
    // sem agendamento de reinício: a TV deve permanecer ligada sempre
    iniciarRolagem();

    if (CONFIG.playlistUrl) setInterval(atualizarPlaylist, CONFIG.atualizarPlaylistMin * 60 * 1000);
    tocarProximo();
}

$('btn-iniciar').addEventListener('click', iniciarTV);
$('btn-pular').addEventListener('click', pular);

document.addEventListener('keydown', e => {
    if (!iniciada) {
        if (e.key === 'Enter' || e.key === ' ') iniciarTV();
        return;
    }
    if (e.key === 'ArrowRight' || e.key === 'MediaTrackNext' || e.key === 'MediaFastForward' || e.keyCode === 417) pular();
    if (e.key === 'u' || e.key === 'U') $('arquivo-csv').click();
});

(async function boot() {
    $('clima-titulo').textContent = 'Clima · ' + CONFIG.cidade;
    atualizarRelogio();
    setInterval(atualizarRelogio, 1000);

    atualizarClima();
    setInterval(atualizarClima, CONFIG.atualizarClimaMin * 60 * 1000);

    carregarAniversariantes();
    setInterval(carregarAniversariantes, CONFIG.atualizarAnivMin * 60 * 1000);

    await atualizarPlaylist();
    let auto = new URLSearchParams(location.search).has('auto');
    try { if (sessionStorage.getItem('tv-auto')) auto = true; } catch (e) {}
    if (auto) iniciarTV();

    console.log('📺 Playlist carregada:', playlist.length, 'itens');
    console.table(playlist);
})();
