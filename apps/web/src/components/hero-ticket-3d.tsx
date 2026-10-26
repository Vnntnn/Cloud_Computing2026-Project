import { useEffect, useRef } from "react";

/** The colours of the tickets, as theme tokens: the sun, the page's teal and the deep orange, so the 3D object wears the site's own colours. */
const bodies = ["--sun", "--primary", "--sun-deep"];

/** Theme tokens are oklch, which three's Color cannot parse; a 2D canvas can, and hands back sRGB bytes. */
function rgbOf(token: string): [number, number, number] {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return [1, 1, 1];
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(token).trim() || "#fff";
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

/**
 * The hero's centrepiece: three inflated, glossy tickets, drawn live in WebGL and lit by a studio environment, so the clear coat
 * catches soft reflections as they turn. They float, and on a mouse they lean toward the pointer with a spring. three loads as its
 * own chunk after the page is up; rendering stops while the hero is off screen or the tab is hidden; under reduced motion one
 * still frame is drawn. Without WebGL nothing is drawn and the photograph behind it carries the hero alone.
 */
export function HeroTicket3D({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let stop = () => {};
    let gone = false;

    Promise.all([import("three"), import("three/examples/jsm/environments/RoomEnvironment.js")]).then(([THREE, { RoomEnvironment }]) => {
      if (gone) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true, powerPreference: "high-performance" });
      } catch {
        return;
      }
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 0.95;
      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      scene.environment = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
      camera.position.set(0, 0, 13);

      const key = new THREE.DirectionalLight(0xfff0d6, 1.6);
      key.position.set(-4, 5, 6);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x6fe0d6, 2.4);
      rim.position.set(5, -2, -4);
      scene.add(rim);

      // the ticket: a card with a half-circle bitten out of each long side, inflated by a deep, round bevel
      const [w, h, r, bite] = [3.1, 1.55, 0.3, 0.2];
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2 + r, -h / 2);
      shape.lineTo(w / 2 - r, -h / 2);
      shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
      shape.lineTo(w / 2, -bite);
      shape.absarc(w / 2, 0, bite, -Math.PI / 2, Math.PI / 2, true);
      shape.lineTo(w / 2, h / 2 - r);
      shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
      shape.lineTo(-w / 2 + r, h / 2);
      shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
      shape.lineTo(-w / 2, bite);
      shape.absarc(-w / 2, 0, bite, Math.PI / 2, -Math.PI / 2, true);
      shape.lineTo(-w / 2, -h / 2 + r);
      shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
      const bevel = 0.17;
      const depth = 0.12;
      const body = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 14, curveSegments: 24 });
      body.translate(0, 0, -depth / 2);
      body.computeVertexNormals();

      // what is printed on the front: the wordmark, the wave lines of the logo and the tear line, in the colour of the page's ink
      const ink = rgbOf("--sun-foreground").map((v) => Math.round(v * 255)).join(",");
      const font = getComputedStyle(document.body).fontFamily;
      const face = document.createElement("canvas");
      face.width = 1536;
      face.height = 768;
      const g = face.getContext("2d");
      if (g) {
        g.strokeStyle = `rgb(${ink})`;
        g.fillStyle = `rgb(${ink})`;
        g.lineCap = "round";
        g.lineWidth = 12;
        for (const y of [250, 300, 350]) {
          g.beginPath();
          for (let x = 130; x <= 520; x += 8) g.lineTo(x, y + Math.sin(((x - 130) / 390) * Math.PI * 2.4) * 26);
          g.stroke();
        }
        g.font = `800 150px ${font}`;
        g.textBaseline = "alphabetic";
        g.fillText("Eventide", 130, 600);
        g.font = `700 44px ${font}`;
        g.globalAlpha = 0.7;
        g.fillText("ADMIT ONE", 1090, 160);
        g.globalAlpha = 1;
        g.setLineDash([22, 26]);
        g.lineWidth = 8;
        g.beginPath();
        g.moveTo(1010, 90);
        g.lineTo(1010, 680);
        g.stroke();
      }
      const print = new THREE.CanvasTexture(face);
      print.colorSpace = THREE.SRGBColorSpace;
      print.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const plate = new THREE.PlaneGeometry(w * 0.98, h * 0.98);

      const disposables: { dispose(): void }[] = [body, plate, print, pmrem];
      const place = [
        { x: 0.2, y: -0.1, z: 0, rz: -0.2, ry: -0.28, s: 1, ink: true },
        { x: -1.9, y: 1.35, z: -1.8, rz: 0.32, ry: 0.4, s: 0.72, ink: false },
        { x: 1.8, y: -1.5, z: -1.2, rz: 0.2, ry: -0.5, s: 0.8, ink: false },
      ];
      const tickets = place.map((p, n) => {
        const [r0, g0, b0] = rgbOf(bodies[n % bodies.length]);
        const material = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color().setRGB(r0, g0, b0, THREE.SRGBColorSpace),
          roughness: 0.28,
          metalness: 0.05,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
          sheen: 0.4,
          sheenColor: new THREE.Color(0xffffff),
          envMapIntensity: 0.75,
        });
        disposables.push(material);
        const group = new THREE.Group();
        group.add(new THREE.Mesh(body, material));
        if (p.ink) {
          const printed = new THREE.MeshPhysicalMaterial({ map: print, transparent: true, roughness: 0.35, clearcoat: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
          disposables.push(printed);
          const front = new THREE.Mesh(plate, printed);
          front.position.z = depth / 2 + bevel + 0.004;
          group.add(front);
        }
        group.scale.setScalar(p.s);
        scene.add(group);
        return { group, p, phase: n * 2.1 };
      });

      const lean = { x: 0, y: 0, tx: 0, ty: 0 };
      const onMove = (e: PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        const box = el.getBoundingClientRect();
        lean.tx = Math.max(-1, Math.min(1, ((e.clientX - box.left) / box.width - 0.5) * 2));
        lean.ty = Math.max(-1, Math.min(1, ((e.clientY - box.top) / box.height - 0.5) * 2));
      };

      const draw = (seconds: number) => {
        lean.x += (lean.tx - lean.x) * 0.06;
        lean.y += (lean.ty - lean.y) * 0.06;
        for (const { group, p, phase } of tickets) {
          const t = seconds * 0.6 + phase;
          group.position.set(p.x + lean.x * 0.25 * p.s, p.y + Math.sin(t) * 0.12 - lean.y * 0.12, p.z);
          group.rotation.set(Math.sin(t * 0.8) * 0.08 + lean.y * 0.3, p.ry + lean.x * 0.45 + Math.cos(t * 0.7) * 0.1, p.rz + Math.sin(t * 0.5) * 0.05);
        }
        renderer.render(scene, camera);
      };

      const size = () => {
        const { clientWidth: cw, clientHeight: ch } = el;
        if (!cw || !ch) return;
        renderer.setSize(cw, ch, false);
        camera.aspect = cw / ch;
        // a short, wide band (a phone's) has less room: pull back so the tickets are not cropped
        camera.position.z = cw / ch > 1.25 ? 9 : 15;
        camera.position.x = cw / ch > 1.25 ? 0 : 0.3;
        camera.position.y = cw / ch > 1.25 ? 0 : -1;
        camera.updateProjectionMatrix();
      };

      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
      let visible = true;
      let raf = 0;
      const t0 = performance.now();
      const frame = () => {
        raf = 0;
        draw((performance.now() - t0) / 1000);
        if (visible && !document.hidden && !still) raf = requestAnimationFrame(frame);
      };
      const wake = () => {
        if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
      };
      const resize = new ResizeObserver(() => {
        size();
        draw((performance.now() - t0) / 1000);
      });
      resize.observe(el);
      const view = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) wake();
      });
      view.observe(el);
      if (!still) {
        document.addEventListener("visibilitychange", wake);
        window.addEventListener("pointermove", onMove, { passive: true });
      }
      size();
      wake();

      stop = () => {
        cancelAnimationFrame(raf);
        resize.disconnect();
        view.disconnect();
        document.removeEventListener("visibilitychange", wake);
        window.removeEventListener("pointermove", onMove);
        for (const d of disposables) d.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      };
    });

    return () => {
      gone = true;
      stop();
    };
  }, []);

  return <canvas ref={canvas} aria-hidden className={className} />;
}
