import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Play, Pause, Loader2 } from "lucide-react";

export default function AvatarCanvas({
  fileName,
  audioUrl: propAudioUrl,
}: {
  fileName?: string;
  audioUrl?: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  const faceMeshRef = useRef<THREE.Mesh | null>(null);
  const mouthIndexRef = useRef<number | null>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 🔊 WebAudio
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  const [audioUrl, setAudioUrl] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  // =============================
  // PLAY AUDIO WITH ANALYSER
  // =============================
  const playAudio = async (url: string) => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
      }

      if (!audioCtxRef.current) {
        const audioCtx = new AudioContext();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;

        audioCtxRef.current = audioCtx;
        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.fftSize);
      }

      const audio = new Audio(url);
      audio.crossOrigin = "anonymous";

      const source = audioCtxRef.current!.createMediaElementSource(audio);
      source.connect(analyserRef.current!);
      analyserRef.current!.connect(audioCtxRef.current!.destination);

      audio.onended = () => setIsPlaying(false);

      audioRef.current = audio;
      setAudioUrl(url);

      await audioCtxRef.current!.resume();
      await audio.play();

      setIsPlaying(true);
      console.log("▶ Playing audio:", url);
    } catch (err) {
      console.error("❌ Audio play failed:", err);
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    if (propAudioUrl) {
      playAudio(propAudioUrl);
    }
  }, [propAudioUrl]);

  // =============================
  // INIT THREE
  // =============================
  useEffect(() => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef5fd);

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

      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      model.position.y += 0.3;

      model.traverse((obj: any) => {
        if (obj.isMesh && obj.morphTargetDictionary) {
          const candidates = [
            "mouthOpen",
            "JawOpen",
            "viseme_aa",
            "viseme_O",
            "MouthOpen",
            "mouth_open",
          ];

          const foundTarget = candidates.find(
            (key) => obj.morphTargetDictionary[key] !== undefined,
          );

          if (foundTarget) {
            faceMeshRef.current = obj;
            mouthIndexRef.current = obj.morphTargetDictionary[foundTarget];
            obj.frustumCulled = false;
            console.log("✅ Face mesh bound:", obj.name, foundTarget);
          }
        }
      });

      scene.add(model);
    });

    const animate = () => {
      requestAnimationFrame(animate);

      // =============================
      // AUDIO AMPLITUDE LIPSYNC
      // =============================
      if (
        faceMeshRef.current &&
        mouthIndexRef.current !== null &&
        analyserRef.current &&
        dataArrayRef.current
      ) {
        analyserRef.current.getByteTimeDomainData(dataArrayRef.current as any);

        let sum = 0;
        for (let i = 0; i < dataArrayRef.current.length; i++) {
          const v = (dataArrayRef.current[i] - 128) / 128;
          sum += v * v;
        }

        const rms = Math.sqrt(sum / dataArrayRef.current.length);
        const lipValue = Math.min(Math.max(rms * 10, 0), 1);

        faceMeshRef.current.morphTargetInfluences![mouthIndexRef.current] =
          lipValue;
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      renderer.dispose();
      audioCtxRef.current?.close();
      if (mountRef.current) mountRef.current.innerHTML = "";
    };
  }, []);

  // =============================
  // PLAY / PAUSE BUTTON LOGIC
  // =============================
  const handlePlayPause = async () => {
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
      return;
    }

    if (audioRef.current && audioUrl) {
      audioRef.current.play();
      setIsPlaying(true);
      return;
    }

    if (audioUrl) {
      await playAudio(audioUrl);
      return;
    }

    if (!fileName) {
      console.error("❌ fileName is undefined");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("http://localhost:5000/api/learning-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName }),
      });

      const data = await res.json();
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
      <div ref={mountRef} className="w-full h-full" />

      <button
        onClick={handlePlayPause}
        disabled={loading}
        className={`
          absolute bottom-6 left-1/2 -translate-x-1/2 
          flex items-center justify-center w-14 h-14 rounded-full 
          shadow-lg backdrop-blur-sm transition-all duration-300 transform hover:scale-105 active:scale-95
          ${
            loading
              ? "bg-white/80 border border-gray-200 cursor-wait"
              : isPlaying
                ? "bg-rose-500 hover:bg-rose-600 text-white"
                : "bg-indigo-600 hover:bg-indigo-700 text-white"
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
