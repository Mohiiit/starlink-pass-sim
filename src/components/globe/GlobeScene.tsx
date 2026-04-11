'use client';

import { useRef, useMemo, useEffect, forwardRef } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls, Stars, Line } from '@react-three/drei';
import * as THREE from 'three';

const DEG2RAD = Math.PI / 180;
const EARTH_R = 1;
const SAT_ALT = 550 / 6371;
const SAT_R = EARTH_R + SAT_ALT;

interface Props {
  satelliteLat: number;
  satelliteLon: number;
  groundStationLat: number;
  groundStationLon: number;
  elevation_deg: number;
  azimuth_deg: number;
  slantRange_km: number;
  orbitPath: [number, number][];
  currentIndex: number;
  systemHealth: 'nominal' | 'degraded' | 'critical';
  goodput_Mbps: number;
}

function geo2vec(lat: number, lon: number, r: number): THREE.Vector3 {
  const phi = (90 - lat) * DEG2RAD;
  const theta = (lon + 180) * DEG2RAD;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

function healthColor(h: string): THREE.Color {
  if (h === 'critical') return new THREE.Color(0.94, 0.27, 0.27);
  if (h === 'degraded') return new THREE.Color(0.96, 0.62, 0.04);
  return new THREE.Color(0, 0.9, 1.0);
}

// ─── ATMOSPHERE SHADER ───
const atmosVert = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 vp = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-vp.xyz);
    gl_Position = projectionMatrix * vp;
  }
`;
const atmosFrag = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float f = 1.0 - dot(vNormal, vViewDir);
    f = pow(f, 4.0);
    gl_FragColor = vec4(0.3, 0.6, 1.0, f * 0.35);
  }
`;

// ─── EARTH ───
function Earth() {
  const texture = useLoader(THREE.TextureLoader, '/earth-dark.jpg');
  texture.colorSpace = THREE.SRGBColorSpace;

  return (
    <group>
      {/* Textured globe */}
      <mesh>
        <sphereGeometry args={[EARTH_R, 64, 64]} />
        <meshStandardMaterial
          map={texture}
          roughness={0.9}
          metalness={0.05}
          emissiveMap={texture}
          emissive={new THREE.Color(0.15, 0.15, 0.2)}
          emissiveIntensity={0.3}
        />
      </mesh>
      {/* Subtle grid overlay */}
      <mesh>
        <sphereGeometry args={[EARTH_R + 0.003, 12, 6]} />
        <meshBasicMaterial color="#4090cc" wireframe transparent opacity={0.08} depthWrite={false} />
      </mesh>
      {/* Atmosphere glow */}
      <mesh>
        <sphereGeometry args={[EARTH_R + 0.05, 64, 64]} />
        <shaderMaterial
          vertexShader={atmosVert}
          fragmentShader={atmosFrag}
          transparent side={THREE.BackSide} depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// ─── GROUND STATION ───
function GroundStation({ lat, lon }: { lat: number; lon: number }) {
  const pos = useMemo(() => geo2vec(lat, lon, EARTH_R + 0.008), [lat, lon]);
  const normal = useMemo(() => pos.clone().normalize(), [pos]);
  const ringRef = useRef<THREE.Mesh>(null!);
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    return q;
  }, [normal]);

  useFrame(({ clock }) => {
    if (ringRef.current) {
      const s = 1 + 0.35 * Math.sin(clock.elapsedTime * 2);
      ringRef.current.scale.set(s, s, s);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = 0.6 - 0.4 * Math.sin(clock.elapsedTime * 2);
    }
  });

  return (
    <group position={pos}>
      {/* Dish base */}
      <mesh>
        <sphereGeometry args={[0.012, 16, 16]} />
        <meshBasicMaterial color="#22c55e" />
      </mesh>
      {/* Beacon glow */}
      <mesh>
        <sphereGeometry args={[0.022, 16, 16]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.2} depthWrite={false} />
      </mesh>
      {/* Pulse ring */}
      <mesh ref={ringRef} quaternion={quaternion}>
        <ringGeometry args={[0.03, 0.036, 32]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Outer marker ring */}
      <mesh quaternion={quaternion}>
        <ringGeometry args={[0.045, 0.05, 32]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ─── SATELLITE (detailed Starlink model) ───
function Satellite({ lat, lon, health }: { lat: number; lon: number; health: string }) {
  const pos = useMemo(() => geo2vec(lat, lon, SAT_R), [lat, lon]);
  const color = useMemo(() => healthColor(health), [health]);
  const groupRef = useRef<THREE.Group>(null!);
  const glowRef = useRef<THREE.Mesh>(null!);
  const lightRef = useRef<THREE.PointLight>(null!);

  // Orient satellite so its "belly" (antenna) faces Earth
  const orientation = useMemo(() => {
    const q = new THREE.Quaternion();
    const up = pos.clone().normalize();
    q.setFromUnitVectors(new THREE.Vector3(0, -1, 0), up);
    return q;
  }, [pos]);

  useFrame(({ clock }) => {
    if (glowRef.current) {
      const s = 1 + 0.2 * Math.sin(clock.elapsedTime * 3);
      glowRef.current.scale.setScalar(s);
    }
    if (lightRef.current) {
      lightRef.current.intensity = 1.0 + 0.4 * Math.sin(clock.elapsedTime * 3);
    }
  });

  return (
    <group position={pos}>
      <group quaternion={orientation}>
        {/* Main bus (flat box - Starlink is a flat-panel design) */}
        <mesh>
          <boxGeometry args={[0.04, 0.005, 0.025]} />
          <meshStandardMaterial color="#888899" metalness={0.6} roughness={0.3} />
        </mesh>
        {/* Antenna face (bottom) - emissive to show it's active */}
        <mesh position={[0, -0.003, 0]}>
          <boxGeometry args={[0.035, 0.001, 0.022]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} />
        </mesh>
        {/* Solar panel - single large wing (Starlink v1.5 style) */}
        <mesh position={[0.05, 0.001, 0]}>
          <boxGeometry args={[0.055, 0.001, 0.03]} />
          <meshStandardMaterial color="#1a2a50" metalness={0.3} roughness={0.4} emissive="#0a1530" emissiveIntensity={0.3} />
        </mesh>
        {/* Solar panel hinge */}
        <mesh position={[0.022, 0.001, 0]}>
          <boxGeometry args={[0.004, 0.003, 0.006]} />
          <meshStandardMaterial color="#666677" metalness={0.5} roughness={0.4} />
        </mesh>
      </group>
      {/* Inner glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.045, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} depthWrite={false} />
      </mesh>
      {/* Outer glow */}
      <mesh>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.06} depthWrite={false} />
      </mesh>
      <pointLight ref={lightRef} color={color} intensity={1.0} distance={0.6} decay={2} />
    </group>
  );
}

// ─── ORBIT PATH ───
function OrbitPath({ path, currentIndex }: { path: [number, number][]; currentIndex: number }) {
  const pastPoints = useMemo(() => {
    const start = Math.max(0, currentIndex - 100);
    return path.slice(start, currentIndex + 1).map(([lon, lat]) => geo2vec(lat, lon, SAT_R));
  }, [path, currentIndex]);
  const futurePoints = useMemo(() => {
    const end = Math.min(path.length, currentIndex + 100);
    return path.slice(currentIndex, end).map(([lon, lat]) => geo2vec(lat, lon, SAT_R));
  }, [path, currentIndex]);

  return (
    <group>
      {pastPoints.length > 1 && (
        <Line points={pastPoints} color="#00e5ff" lineWidth={2} transparent opacity={0.4} />
      )}
      {futurePoints.length > 1 && (
        <Line points={futurePoints} color="#00e5ff" lineWidth={1} transparent opacity={0.1}
          dashed dashSize={0.015} gapSize={0.015} />
      )}
    </group>
  );
}

// ─── DATA BEAM + PARTICLES ───
const ParticlePoints = forwardRef<THREE.Points, { maxCount: number; posArray: Float32Array; color: THREE.Color }>(
  function ParticlePoints({ posArray, color }, ref) {
    const geomRef = useRef<THREE.BufferGeometry>(null!);
    useEffect(() => {
      if (geomRef.current) {
        geomRef.current.setAttribute('position', new THREE.Float32BufferAttribute(posArray, 3));
        geomRef.current.setDrawRange(0, 0);
      }
    }, [posArray]);
    return (
      <points ref={ref}>
        <bufferGeometry ref={geomRef} />
        <pointsMaterial size={0.016} color={color} transparent opacity={0.9} sizeAttenuation depthWrite={false} />
      </points>
    );
  },
);

function DataBeam({ satLat, satLon, gsLat, gsLon, goodput, health, elevation }: {
  satLat: number; satLon: number; gsLat: number; gsLon: number;
  goodput: number; health: string; elevation: number;
}) {
  const satPos = useMemo(() => geo2vec(satLat, satLon, SAT_R), [satLat, satLon]);
  const gsPos = useMemo(() => geo2vec(gsLat, gsLon, EARTH_R + 0.008), [gsLat, gsLon]);
  const color = useMemo(() => healthColor(health), [health]);
  const beamRef = useRef<THREE.Mesh>(null!);

  const { conePos, coneQuat, coneLength } = useMemo(() => {
    const mid = satPos.clone().add(gsPos).multiplyScalar(0.5);
    const dir = gsPos.clone().sub(satPos);
    const len = dir.length();
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return { conePos: mid, coneQuat: q, coneLength: len };
  }, [satPos, gsPos]);

  const MAX = 60;
  const particlesRef = useRef<THREE.Points>(null!);
  const pData = useRef<{ progress: number; speed: number }[]>([]);
  const pArr = useRef(new Float32Array(MAX * 3));

  useFrame(({ clock }) => {
    if (beamRef.current) {
      const pulse = 0.08 + 0.04 * Math.sin(clock.elapsedTime * 4);
      const flicker = health === 'critical' ? (Math.sin(clock.elapsedTime * 20) > -0.3 ? 1 : 0.15) : 1;
      (beamRef.current.material as THREE.MeshBasicMaterial).opacity = pulse * flicker;
    }
    if (goodput > 0 && elevation > 0) {
      const rate = Math.min(2.5, goodput / 100);
      if (pData.current.length < MAX && Math.random() < rate * 0.5) {
        pData.current.push({ progress: 0, speed: 0.007 + Math.random() * 0.006 });
      }
      let alive = 0;
      const a = pArr.current;
      pData.current = pData.current.filter(p => {
        p.progress += p.speed;
        if (p.progress >= 1) return false;
        a[alive * 3] = satPos.x + (gsPos.x - satPos.x) * p.progress;
        a[alive * 3 + 1] = satPos.y + (gsPos.y - satPos.y) * p.progress;
        a[alive * 3 + 2] = satPos.z + (gsPos.z - satPos.z) * p.progress;
        alive++;
        return true;
      });
      if (particlesRef.current) {
        const attr = particlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
        if (attr) { attr.needsUpdate = true; }
        particlesRef.current.geometry.setDrawRange(0, alive);
      }
    } else {
      pData.current = [];
      if (particlesRef.current) particlesRef.current.geometry.setDrawRange(0, 0);
    }
  });

  if (elevation <= 0 || goodput <= 0) return null;

  return (
    <group>
      <mesh ref={beamRef} position={conePos} quaternion={coneQuat}>
        <cylinderGeometry args={[0.005, 0.03, coneLength, 16, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={[satPos, gsPos]} color={color} lineWidth={2} transparent opacity={0.55} />
      <ParticlePoints ref={particlesRef} maxCount={MAX} posArray={pArr.current} color={color} />
    </group>
  );
}

// ─── SCENE ───
function Scene(props: Props) {
  const groupRef = useRef<THREE.Group>(null!);

  // Auto-rotate globe to show the midpoint between satellite and ground station
  useFrame(() => {
    if (groupRef.current) {
      const midLon = (props.satelliteLon + props.groundStationLon) / 2;
      const midLat = (props.satelliteLat + props.groundStationLat) / 2;
      const ty = -midLon * DEG2RAD;
      const tx = midLat * DEG2RAD * 0.4;
      groupRef.current.rotation.y += (ty - groupRef.current.rotation.y) * 0.03;
      groupRef.current.rotation.x += (tx - groupRef.current.rotation.x) * 0.03;
    }
  });

  return (
    <>
      <ambientLight intensity={0.12} />
      <directionalLight position={[5, 3, 4]} intensity={0.5} color="#ddeeff" />
      <directionalLight position={[-3, -1, -2]} intensity={0.08} color="#223355" />
      <Stars radius={50} depth={40} count={2500} factor={3} saturation={0.1} fade speed={0.3} />
      <OrbitControls enableDamping dampingFactor={0.05} minDistance={1.6} maxDistance={5} enablePan={false} rotateSpeed={0.5} />
      <group ref={groupRef}>
        <Earth />
        <GroundStation lat={props.groundStationLat} lon={props.groundStationLon} />
        <OrbitPath path={props.orbitPath} currentIndex={props.currentIndex} />
        <Satellite lat={props.satelliteLat} lon={props.satelliteLon} health={props.systemHealth} />
        <DataBeam satLat={props.satelliteLat} satLon={props.satelliteLon}
          gsLat={props.groundStationLat} gsLon={props.groundStationLon}
          goodput={props.goodput_Mbps} health={props.systemHealth} elevation={props.elevation_deg} />
      </group>
    </>
  );
}

export default function GlobeScene(props: Props) {
  return (
    <div className="w-full h-full" style={{ background: '#030508' }}>
      <Canvas camera={{ position: [0, 0.5, 2.6], fov: 45 }} gl={{ antialias: true, alpha: false }}
        style={{ background: '#030508' }}>
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
