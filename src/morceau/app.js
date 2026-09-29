const IS_APPLE_WEBKIT = (() => {
  const ua = navigator.userAgent;
  if (/iP(hone|od|ad)/.test(ua)) return true;
  if (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true;
  if (
    /Safari\//.test(ua) &&
    !/(Chrome|Chromium|CriOS|FxiOS|Edg|EdgA|EdgiOS|OPR|OPiOS|YaBrowser|Vivaldi|Brave)/.test(ua)
  )
    return true;
  return false;
})();
const VIDEO_EXT = IS_APPLE_WEBKIT ? 'mp4' : 'webm';

const CLIPS = {
  intro: `/morceau/video/01_intro.${VIDEO_EXT}`,
  description: `/morceau/video/02_attente_lecture.${VIDEO_EXT}`,
  aTonAvis: `/morceau/video/03_a_ton_avis.${VIDEO_EXT}`,
  vote: `/morceau/video/04_attente_vote.${VIDEO_EXT}`,
  fin: `/morceau/video/05_fin.${VIDEO_EXT}`,
};

const BIRDS_AUDIO = '/morceau/audio/birds.mp3';
const RESULTS_OVERLAY_MS = 12000;

const screens = new Map();
document.querySelectorAll('.screen').forEach((el) => {
  screens.set(el.dataset.screen, el);
});

const SCREEN_OF_CLIP = {
  intro: 'intro',
  description: 'description',
  aTonAvis: 'a-ton-avis',
  vote: 'vote',
  fin: 'results',
};
for (const [clipKey, screenName] of Object.entries(SCREEN_OF_CLIP)) {
  screens.get(screenName).querySelector('video').src = CLIPS[clipKey];
}

let currentVideo = null;
let currentVideoEnded = null;
let birdsAudio = null;
let resultsTimer = null;

function show(name) {
  document.querySelectorAll('.screen[data-active]').forEach((el) => el.removeAttribute('data-active'));
  const next = screens.get(name);
  if (!next) throw new Error(`Unknown screen: ${name}`);
  next.setAttribute('data-active', '');
}

function leaveCurrent() {
  if (currentVideo) {
    if (currentVideoEnded) currentVideo.removeEventListener('ended', currentVideoEnded);
    currentVideo.pause();
    currentVideo = null;
    currentVideoEnded = null;
  }
  if (birdsAudio) {
    birdsAudio.pause();
    birdsAudio = null;
  }
  if (resultsTimer) {
    clearTimeout(resultsTimer);
    resultsTimer = null;
  }
}

function playClip(screenName, onEnded) {
  const video = screens.get(screenName).querySelector('video');
  video.currentTime = 0;
  currentVideo = video;
  if (onEnded) {
    currentVideoEnded = onEnded;
    video.addEventListener('ended', onEnded, { once: true });
  }
  const p = video.play();
  if (p && p.catch) p.catch((err) => console.warn(`play() failed for ${screenName}:`, err));
}

function enter(name) {
  leaveCurrent();
  show(name);

  switch (name) {
    case 'audio-gate': {
      birdsAudio = new Audio(BIRDS_AUDIO);
      birdsAudio.loop = true;
      const tryPlay = () => birdsAudio && birdsAudio.play().catch(() => {});
      tryPlay();
      // Most mobile browsers block autoplay; retry on first user gesture.
      document.addEventListener('pointerdown', tryPlay, { once: true, capture: true });
      break;
    }
    case 'intro':
      playClip('intro', () => enter('description'));
      break;
    case 'description':
      playClip('description', null);
      break;
    case 'a-ton-avis':
      playClip('a-ton-avis', () => enter('vote'));
      break;
    case 'vote':
      playClip('vote', null);
      break;
    case 'results': {
      const overlay = screens.get('results').querySelector('.results-overlay');
      overlay.classList.remove('results-overlay--hidden');
      resultsTimer = setTimeout(() => overlay.classList.add('results-overlay--hidden'), RESULTS_OVERLAY_MS);
      playClip('results', () => enter('credits'));
      break;
    }
    case 'credits':
      break;
  }
}

document.addEventListener('click', (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.matches('[data-action="advance"]')) {
    const screen = target.closest('.screen').dataset.screen;
    if (screen === 'audio-intro') {
      enter('audio-gate');
      return;
    }
    if (screen === 'audio-gate') {
      enter('intro');
      return;
    }
    if (screen === 'description') {
      enter('a-ton-avis');
      return;
    }
  }

  if (target.matches('[data-vote]')) {
    enter('results');
  }
});

enter('audio-intro');
