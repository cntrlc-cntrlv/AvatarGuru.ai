import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Play, Pause, Loader2 } from "lucide-react";

/**
 * AvatarCanvas.tsx — Full-featured, ACTIVE avatar renderer.
 *
 * This is the production component used in Study.tsx.
 * It extends Avatar.tsx with:
 *   - A Play/Pause button with a loading spinner
 *   - Lazy AudioContext creation (only on first user gesture — safer)
 *   - Dynamic morph target discovery (tries 6 known key names instead of hardcoding)
 *   - Fallback audio fetch: if no audioUrl is provided, calls /api/learning-tts
 *
 * Two ways audio can start:
 *   A) AUTOMATIC — parent (Study.tsx) sets `audioUrl` prop (e.g. after batch play click
 *      or voice Q&A response). The propAudioUrl useEffect fires playAudio() immediately.
 *   B) MANUAL — user clicks the Play button. handlePlayPause() runs its state machine.
 */
export default function AvatarCanvas({
  fileName,
  audioUrl: propAudioUrl,
}: {
  fileName?: string;
  audioUrl?: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  // Ref to the face mesh that has a mouth morph target
  const faceMeshRef = useRef<THREE.Mesh | null>(null);
  // Numeric index of the found morph target inside morphTargetInfluences[]
  const mouthIndexRef = useRef<number | null>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // The currently playing HTML Audio element
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 🔊 Web Audio API refs — created lazily on first playAudio() call
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // Raw waveform sample buffer (0–255, length = fftSize = 1024)
  const dataArrayRef = useRef<Uint8Array | null>(null);

  // The absolute audio URL currently loaded (used to resume after pause)
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  // True while fetching audio from /api/learning-tts (shows spinner)
  const [loading, setLoading] = useState(false);

  // =============================
  // PLAY AUDIO WITH ANALYSER
  // Core audio wiring function. Called from both:
  //   - propAudioUrl useEffect (automatic, from parent)
  //   - handlePlayPause (manual, from button click)
  // Creates the AudioContext lazily (only once) to comply with browser
  // autoplay policies that require a user gesture before audio can play.
  // =============================
  const playAudio = async (url: string) => {
    try {
      // Stop any currently playing audio
      if (audioRef.current) {
        audioRef.current.pause();
      }

      // ── Lazy AudioContext Creation ─────────────────────────────────────────
      // Unlike Avatar.tsx which creates AudioContext at mount time,
      // we create it here — inside a function that is always triggered by
      // a user gesture (click) or a prop change driven by a user action.
      // This avoids the browser's "AudioContext was prevented from starting
      // automatically" warning.
      if (!audioCtxRef.current) {
        const audioCtx = new AudioContext();
        const analyser = audioCtx.createAnalyser();
        // fftSize = 1024 → 1024 time-domain waveform samples per frame
        analyser.fftSize = 1024;

        audioCtxRef.current = audioCtx;
        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.fftSize);
      }

      // Step 1 — Create a standard HTML audio element pointing at the URL
      const audio = new Audio(url);
      // Required for Web Audio API cross-origin access (Flask runs on localhost:5000)
      audio.crossOrigin = "anonymous";

      // Step 2 — Wrap it as a Web Audio source node
      // new Audio(url) → MediaElementSource → AnalyserNode → AudioDestination
      //                                           ↓
      //                               waveform data read each animation frame
      const source = audioCtxRef.current!.createMediaElementSource(audio);

      // Step 3 — Connect source → analyser (for amplitude reading)
      source.connect(analyserRef.current!);

      // Step 4 — Connect analyser → speakers (this is what actually outputs sound)
      // audioCtx.destination is the browser's hardware audio output (speakers/headphones).
      // The AnalyserNode is a pass-through — audio flows through it unchanged to the speakers,
      // while the animation loop can also peek at the waveform for lip sync.
      analyserRef.current!.connect(audioCtxRef.current!.destination);

      audio.onended = () => setIsPlaying(false);

      audioRef.current = audio;
      setAudioUrl(url);

      // Resume AudioContext in case the browser suspended it
      await audioCtxRef.current!.resume();
      await audio.play();

      setIsPlaying(true);
      console.log("▶ Playing audio:", url);
    } catch (err) {
      console.error("❌ Audio play failed:", err);
      setIsPlaying(false);
    }
  };

  // =============================
  // AUTOMATIC PLAYBACK (from parent prop)
  // When Study.tsx sets avatarAudioUrl state (e.g. after user clicks
  // "🔊 Play Audio" on a batch, or a voice Q&A response arrives),
  // that value flows in as propAudioUrl and immediately triggers playAudio().
  // This bypasses the manual Play button entirely.
  // =============================
  useEffect(() => {
    if (propAudioUrl) {
      playAudio(propAudioUrl);
    }
  }, [propAudioUrl]);

  // =============================
  // INIT THREE.JS (runs once on mount)
  // Sets up scene, camera, renderer, lights, loads the GLTF model,
  // dynamically finds the mouth morph target, and starts the animation loop.
  // =============================
  useEffect(() => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef5fd);

    // Narrower FOV (50) vs Avatar.tsx (100) — gives a tighter face close-up
    const camera = new THREE.PerspectiveCamera(
      50,
      mountRef.current!.clientWidth / mountRef.current!.clientHeight,
      0.1,
      5,
    );
    camera.position.set(0, 0.3, 1.3);
    camera.lookAt(0, 0.2, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(
      mountRef.current!.clientWidth,
      mountRef.current!.clientHeight,
    );
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current!.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(0, 2, 2);
    scene.add(dirLight);

    const loader = new GLTFLoader();
    loader.load("/avatar/face9.glb", (gltf) => {
      const model = gltf.scene;

      // Center the model in the scene
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      model.position.y += 0.3;

      // ── Dynamic Morph Target Discovery ──────────────────────────────────────
      // Instead of hardcoding a mesh name like Avatar.tsx does with "Object_4",
      // we traverse ALL meshes and check for any of 6 known mouth morph target
      // key names. This makes the component compatible with multiple avatar
      // formats: ReadyPlayer Me, Mixamo, VRM, etc.
      model.traverse((obj: any) => {
        if (obj.isMesh && obj.morphTargetDictionary) {
          const candidates = [
            "mouthOpen",   // ReadyPlayer Me
            "JawOpen",     // Mixamo
            "viseme_aa",   // ARKit / Apple
            "viseme_O",    // ARKit / Apple
            "MouthOpen",   // VRM
            "mouth_open",  // generic lowercase
          ];

          const foundTarget = candidates.find(
            (key) => obj.morphTargetDictionary[key] !== undefined,
          );

          if (foundTarget) {
            faceMeshRef.current = obj;
            mouthIndexRef.current = obj.morphTargetDictionary[foundTarget];
            // Disable frustum culling so mouth animates even when near edge of view
            obj.frustumCulled = false;
            console.log("✅ Face mesh bound:", obj.name, foundTarget);
          }
        }
      });

      scene.add(model);
    });

    // ── Animation Loop ─────────────────────────────────────────────────────
    // requestAnimationFrame runs ~60 times/second.
    // Each frame: read waveform amplitude → compute RMS → update mouth morph.
    const animate = () => {
      requestAnimationFrame(animate);

      // ── AUDIO AMPLITUDE LIP SYNC ──────────────────────────────────────────
      // All 4 refs must be ready: mesh, morph index, analyser, and data buffer.
      // The analyserRef is null until the user first plays audio (lazy init).
      if (
        faceMeshRef.current &&
        mouthIndexRef.current !== null &&
        analyserRef.current &&
        dataArrayRef.current
      ) {
        // Fill the buffer with the current audio frame's time-domain waveform.
        // Each value is 0–255; 128 = silence (the zero-crossing baseline).
        analyserRef.current.getByteTimeDomainData(dataArrayRef.current as any);

        // ── RMS Amplitude Calculation ────────────────────────────────────────
        // RMS (Root Mean Square) measures overall audio energy in this frame.
        //
        // Steps:
        //   1. For each sample: normalize (byte − 128) / 128 → range [-1, 1]
        //   2. Square it (removes negatives, emphasizes peaks)
        //   3. Sum all squared values, divide by count → mean square
        //   4. Square root → RMS amplitude
        //
        // Typical values:
        //   Silence  → rms ≈ 0.000
        //   Quiet speech → rms ≈ 0.05
        //   Loud speech  → rms ≈ 0.10+
        let sum = 0;
        for (let i = 0; i < dataArrayRef.current.length; i++) {
          const v = (dataArrayRef.current[i] - 128) / 128;
          sum += v * v;
        }

        const rms = Math.sqrt(sum / dataArrayRef.current.length);

        // Scale rms × 10 so typical speech (0.05–0.1) maps to visible [0.5–1.0].
        // Clamp to [0, 1] — Three.js morph target influences must stay in this range.
        //   rms=0 (silence)     → lipValue=0 → mouth fully closed
        //   rms=0.1 (speech)    → lipValue=1 → mouth fully open
        const lipValue = Math.min(Math.max(rms * 10, 0), 1);

        // Write to the morph target influence array — this is what physically
        // moves the avatar's jaw/mouth mesh vertices each frame.
        faceMeshRef.current.morphTargetInfluences![mouthIndexRef.current] =
          lipValue;
      }

      renderer.render(scene, camera);
    };

    animate();

    // Cleanup: free GPU memory and close AudioContext on unmount
    return () => {
      renderer.dispose();
      audioCtxRef.current?.close();
      if (mountRef.current) mountRef.current.innerHTML = "";
    };
  }, []);

  // =============================
  // PLAY / PAUSE BUTTON LOGIC
  //
  // State machine with 4 branches:
  //
  //   1. isPlaying=true  → pause current audio
  //   2. isPlaying=false, audioRef exists, audioUrl set → resume existing audio
  //   3. isPlaying=false, audioUrl in state but no audio object → re-create and play
  //   4. No audio at all → fetch from /api/learning-tts using fileName prop,
  //      then play the returned audio_url
  // =============================
  const handlePlayPause = async () => {
    // Branch 1: Currently playing → pause
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
      return;
    }

    // Branch 2: Paused, audio object already exists → resume
    if (audioRef.current && audioUrl) {
      audioRef.current.play();
      setIsPlaying(true);
      return;
    }

    // Branch 3: Have a URL in state but no audio object (e.g. after re-mount) → replay
    if (audioUrl) {
      await playAudio(audioUrl);
      return;
    }

    // Branch 4: No audio yet → fetch from the learning TTS endpoint
    if (!fileName) {
      console.error("❌ fileName is undefined");
      return;
    }

    setLoading(true);

    try {
      // POST /api/learning-tts with the current file name.
      // Backend returns { audio_url: "/api/tts-audio/<gridfs_id>" }
      const res = await fetch("http://localhost:5000/api/learning-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName }),
      });

      const data = await res.json();
      // Prepend base URL since audio_url is a relative path like "/api/tts-audio/..."
      const finalAudioUrl = "http://localhost:5000" + data.audio_url;

      setAudioUrl(finalAudioUrl);
      await playAudio(finalAudioUrl);
    } catch (err) {
      console.error("❌ Audio load/play failed:", err);
    } finally {
      setLoading(false);
    }
  };

  // =============================
  // UI
  // =============================
  return (
    <div className="relative w-full h-full bg-[#EEF5FD] overflow-hidden group">
      {/* Three.js canvas is injected here by the renderer */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Play/Pause button — overlaid at the bottom centre of the canvas */}
      <button
        onClick={handlePlayPause}
        disabled={loading}
        className={`
          absolute bottom-6 left-1/2 -translate-x-1/2 
          flex items-center justify-center w-14 h-14 rounded-full 
          shadow-lg backdrop-blur-sm transition-all duration-300 transform hover:scale-105 active:scale-95
          ${loading
            ? "bg-white/80 border border-gray-200 cursor-wait"
            : isPlaying
              ? "bg-rose-500 hover:bg-rose-600 text-white"   // red when playing
              : "bg-indigo-600 hover:bg-indigo-700 text-white" // indigo when paused
          }
        `}
      >
        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
        ) : isPlaying ? (
          <Pause className="w-6 h-6 fill-current" />
        ) : (
          <Play className="w-6 h-6 fill-current ml-1" />
        )}
      </button>
    </div>
  );
}
