import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export default function AvatarCanvas({ audioUrl }: { audioUrl?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  const faceMeshRef = useRef<THREE.Mesh | null>(null);
  const mouthIndexRef = useRef<number | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // =============================
  // INIT THREE.JS
  // =============================
  useEffect(() => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef5fd);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      100,
      mountRef.current!.clientWidth / mountRef.current!.clientHeight,
      1.01,
      100000,
    );
    camera.position.set(0, 3.5, 2.5);
    camera.lookAt(0, 3.5, 1.5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(
      mountRef.current!.clientWidth,
      mountRef.current!.clientHeight,
    );
    mountRef.current!.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(0, 2, 2);
    scene.add(dirLight);

    // Load model
    const loader = new GLTFLoader();
    loader.load("/avatar/girl3.glb", (gltf) => {
      const model = gltf.scene;
      model.scale.set(1, 1, 1);
      model.position.set(0, 0, 0);

      model.traverse((obj: any) => {
        if (
          obj.isMesh &&
          obj.name === "Object_4" &&
          obj.morphTargetDictionary?.["mouthOpen"] !== undefined
        ) {
          faceMeshRef.current = obj;
          mouthIndexRef.current = obj.morphTargetDictionary["mouthOpen"];
          obj.frustumCulled = false;

          console.log("✅ Face mesh bound:", obj.name);
        }
      });

      scene.add(model);
    });

    // WebAudio
    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;
    dataArrayRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));

    // Resize
    const handleResize = () => {
      if (!rendererRef.current || !cameraRef.current || !mountRef.current)
        return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      rendererRef.current.setSize(w, h);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
    };

    window.addEventListener("resize", handleResize);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);

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
        let lipValue = Math.min(Math.max(rms * 10, 0), 1);
        faceMeshRef.current.morphTargetInfluences![mouthIndexRef.current] =
          lipValue;
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      audioCtx.close();
    };
  }, []);

  // =============================
  // PLAY AUDIO WHEN URL CHANGES
  // =============================
  useEffect(() => {
    if (!audioUrl || !audioCtxRef.current || !analyserRef.current) return;

    audioCtxRef.current.resume();

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(audioUrl);
    audio.crossOrigin = "anonymous";

    const source = audioCtxRef.current.createMediaElementSource(audio);
    source.connect(analyserRef.current);
    analyserRef.current.connect(audioCtxRef.current.destination);

    audio.play();
    audioRef.current = audio;
  }, [audioUrl]);

  return <div ref={mountRef} className="w-full h-full bg-white" />;
}
