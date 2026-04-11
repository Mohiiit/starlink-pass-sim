'use client';

import { useRef, useMemo, useEffect, forwardRef } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls, Stars, Line } from '@react-three/drei';
import * as THREE from 'three';

const DEG2RAD = Math.PI / 180;
const EARTH_R = 1;
// Visual exaggeration: real altitude is 550/6371 = 0.086 (barely visible).
// We use 0.4 so the satellite is dramatically floating above the globe.
const SAT_ALT = 0.4;
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
  beamQuality_percent: number;
  retransmissionRate: number;
  packetErrorRate: number;
  queueDepth_packets: number;
  trackingLocked: boolean;
  trackingError_Hz: number;
  powerMode: number;
  degradedSubarrays: number;
  statusSummary: string;
  activeFaultLabels: string[];
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
    f = pow(f, 6.0);
    gl_FragColor = vec4(0.2, 0.5, 1.0, f * 0.15);
  }
`;

// ─── EARTH ───
function Earth() {
  const texture = useLoader(THREE.TextureLoader, '/earth-dark.jpg');
  const srgbTexture = useMemo(() => {
    const cloned = texture.clone();
    cloned.colorSpace = THREE.SRGBColorSpace;
    return cloned;
  }, [texture]);

  return (
    <group>
      {/* Textured globe */}
      <mesh>
        <sphereGeometry args={[EARTH_R, 64, 64]} />
        <meshStandardMaterial
          map={srgbTexture}
          roughness={0.9}
          metalness={0.05}
          emissiveMap={srgbTexture}
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
        <sphereGeometry args={[0.027, 16, 16]} />
        <meshBasicMaterial color="#22c55e" />
      </mesh>
      {/* Beacon glow */}
      <mesh>
        <sphereGeometry args={[0.038, 16, 16]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.18} depthWrite={false} />
      </mesh>
      {/* Pulse ring */}
      <mesh ref={ringRef} quaternion={quaternion}>
        <ringGeometry args={[0.055, 0.064, 32]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Outer marker ring */}
      <mesh quaternion={quaternion}>
        <ringGeometry args={[0.074, 0.08, 32]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ─── SATELLITE (detailed Starlink model) ───
function Satellite({ lat, lon, health }: { lat: number; lon: number; health: string }) {
  const pos = useMemo(() => geo2vec(lat, lon, SAT_R), [lat, lon]);
  const color = useMemo(() => healthColor(health), [health]);
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
      lightRef.current.intensity = 2.0 + 0.4 * Math.sin(clock.elapsedTime * 3);
    }
  });

  return (
    <group position={pos}>
      <group quaternion={orientation} scale={2.0}>
        {/* Main bus (flat box - Starlink is a flat-panel design) */}
        <mesh>
          <boxGeometry args={[0.045, 0.012, 0.025]} />
          <meshStandardMaterial color="#888899" metalness={0.6} roughness={0.3} />
        </mesh>
        {/* Antenna face (bottom) - emissive to show it's active */}
        <mesh position={[0, -0.003, 0]}>
          <boxGeometry args={[0.04, 0.001, 0.022]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} />
        </mesh>
        {/* Solar panel - single large wing (Starlink v1.5 style) */}
        <mesh position={[0.05, 0.001, 0]}>
          <boxGeometry args={[0.065, 0.001, 0.035]} />
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
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} />
      </mesh>
      {/* Mid glow */}
      <mesh>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} depthWrite={false} />
      </mesh>
      {/* Outer glow */}
      <mesh>
        <sphereGeometry args={[0.4, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.08} depthWrite={false} />
      </mesh>
      <pointLight ref={lightRef} color={color} intensity={4.0} distance={2.0} decay={2} />
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
        <Line points={pastPoints} color="#00e5ff" lineWidth={3} transparent opacity={0.55} />
      )}
      {futurePoints.length > 1 && (
        <Line points={futurePoints} color="#00e5ff" lineWidth={2} transparent opacity={0.18}
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
        <pointsMaterial size={0.045} color={color} transparent opacity={0.95} sizeAttenuation depthWrite={false} />
      </points>
    );
  },
);

function DataBeam({ satLat, satLon, gsLat, gsLon, goodput, health, elevation, beamQuality, retransmissionRate, packetErrorRate, trackingLocked, queueDepth }: {
  satLat: number; satLon: number; gsLat: number; gsLon: number;
  goodput: number; health: string; elevation: number;
  beamQuality: number; retransmissionRate: number; packetErrorRate: number; trackingLocked: boolean; queueDepth: number;
}) {
  const satPos = useMemo(() => geo2vec(satLat, satLon, SAT_R), [satLat, satLon]);
  const gsPos = useMemo(() => geo2vec(gsLat, gsLon, EARTH_R + 0.008), [gsLat, gsLon]);
  const color = useMemo(() => healthColor(health), [health]);
  const beamRef = useRef<THREE.Mesh>(null!);
  const beamHaloRef = useRef<THREE.Mesh>(null!);
  const footprintRef = useRef<THREE.Mesh>(null!);

  const { conePos, coneQuat, coneLength } = useMemo(() => {
    const mid = satPos.clone().add(gsPos).multiplyScalar(0.5);
    const dir = gsPos.clone().sub(satPos);
    const len = dir.length();
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return { conePos: mid, coneQuat: q, coneLength: len };
  }, [satPos, gsPos]);

  const footprintNormal = useMemo(() => gsPos.clone().normalize(), [gsPos]);
  const footprintQuat = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), footprintNormal);
    return q;
  }, [footprintNormal]);
  const coreFootprint = useMemo(
    () => 0.06 + 0.03 * Math.max(0, 1 - beamQuality / 100) + 0.015 * Math.min(1, queueDepth / 15000),
    [beamQuality, queueDepth],
  );

  const MAX = 220;
  const particlesRef = useRef<THREE.Points>(null!);
  const returnParticlesRef = useRef<THREE.Points>(null!);
  const pData = useRef<{ progress: number; speed: number; laneOffset: number }[]>([]);
  const returnData = useRef<{ progress: number; speed: number; laneOffset: number }[]>([]);
  const pArr = useRef(new Float32Array(MAX * 3));
  const returnArr = useRef(new Float32Array(MAX * 3));

  useFrame(({ clock }) => {
    const throughputFactor = Math.min(1, Math.max(0, goodput / 800));
    const qualityFactor = Math.max(0.35, beamQuality / 100);
    const beamOpacityBase = elevation > 0
      ? 0.25 + 0.35 * throughputFactor * qualityFactor + (health === 'critical' ? 0.05 : 0.1)
      : 0;
    if (beamRef.current) {
      const pulse = 0.85 + 0.15 * Math.sin(clock.elapsedTime * 4);
      const flicker = !trackingLocked
        ? (Math.sin(clock.elapsedTime * 24) > -0.2 ? 1 : 0.08)
        : health === 'critical'
          ? (Math.sin(clock.elapsedTime * 20) > -0.3 ? 1 : 0.15)
          : 1;
      (beamRef.current.material as THREE.MeshBasicMaterial).opacity = beamOpacityBase * pulse * flicker;
    }
    if (beamHaloRef.current) {
      const sweep = 0.8 + 0.2 * Math.sin(clock.elapsedTime * 2.5);
      (beamHaloRef.current.material as THREE.MeshBasicMaterial).opacity = beamOpacityBase * 0.45 * sweep;
    }
    if (footprintRef.current) {
      const footprintPulse = 0.85 + 0.15 * Math.sin(clock.elapsedTime * 3.5);
      (footprintRef.current.material as THREE.MeshBasicMaterial).opacity = (0.35 + 0.25 * throughputFactor) * footprintPulse;
    }
    if (goodput > 0 && elevation > 0) {
      const rate = Math.min(9, Math.max(1.4, goodput / 55));
      if (pData.current.length < MAX && Math.random() < rate * 0.68) {
        pData.current.push({
          progress: 0,
          speed: 0.01 + Math.random() * 0.01,
          laneOffset: (Math.random() - 0.5) * 0.014,
        });
      }
      let alive = 0;
      const a = pArr.current;
      const travel = gsPos.clone().sub(satPos);
      const laneNormal = travel.clone().cross(satPos.clone().normalize()).normalize();
      pData.current = pData.current.filter(p => {
        p.progress += p.speed;
        if (p.progress >= 1) return false;
        const pos = satPos.clone().lerp(gsPos, p.progress).addScaledVector(laneNormal, p.laneOffset);
        a[alive * 3] = pos.x;
        a[alive * 3 + 1] = pos.y;
        a[alive * 3 + 2] = pos.z;
        alive++;
        return true;
      });
      if (particlesRef.current) {
        const attr = particlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
        if (attr) { attr.needsUpdate = true; }
        particlesRef.current.geometry.setDrawRange(0, alive);
      }

      const reverseRate = Math.min(3.5, Math.max(retransmissionRate * 26, packetErrorRate * 10));
      if (reverseRate > 0 && returnData.current.length < MAX && Math.random() < reverseRate * 0.55) {
        returnData.current.push({
          progress: 0,
          speed: 0.008 + Math.random() * 0.006,
          laneOffset: (Math.random() - 0.5) * 0.01,
        });
      }
      let reverseAlive = 0;
      const reverseArray = returnArr.current;
      returnData.current = returnData.current.filter((p) => {
        p.progress += p.speed;
        if (p.progress >= 1) return false;
        const pos = gsPos.clone().lerp(satPos, p.progress).addScaledVector(laneNormal, p.laneOffset);
        reverseArray[reverseAlive * 3] = pos.x;
        reverseArray[reverseAlive * 3 + 1] = pos.y;
        reverseArray[reverseAlive * 3 + 2] = pos.z;
        reverseAlive++;
        return true;
      });
      if (returnParticlesRef.current) {
        const attr = returnParticlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
        if (attr) attr.needsUpdate = true;
        returnParticlesRef.current.geometry.setDrawRange(0, reverseAlive);
      }
    } else {
      pData.current = [];
      returnData.current = [];
      if (particlesRef.current) particlesRef.current.geometry.setDrawRange(0, 0);
      if (returnParticlesRef.current) returnParticlesRef.current.geometry.setDrawRange(0, 0);
    }
  });

  if (elevation <= 0) return null;

  return (
    <group>
      {/* Outer beam halo — wide, soft glow */}
      <mesh ref={beamHaloRef} position={conePos} quaternion={coneQuat}>
        <cylinderGeometry args={[0.025, 0.12, coneLength, 32, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Inner beam core — bright, narrower */}
      <mesh ref={beamRef} position={conePos} quaternion={coneQuat}>
        <cylinderGeometry args={[0.015, 0.07, coneLength, 24, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={footprintRef} position={gsPos} quaternion={footprintQuat}>
        <ringGeometry args={[coreFootprint, coreFootprint + 0.012, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={[satPos, gsPos]} color={color} lineWidth={5} transparent opacity={goodput > 0 ? 0.95 : 0.3} />
      <ParticlePoints ref={particlesRef} maxCount={MAX} posArray={pArr.current} color={color} />
      <ParticlePoints ref={returnParticlesRef} maxCount={MAX} posArray={returnArr.current} color={new THREE.Color(1.0, 0.75, 0.2)} />
    </group>
  );
}

// ─── SCENE ───
function Scene(props: Props) {
  const groupRef = useRef<THREE.Group>(null!);

  // Auto-rotate globe so the beam is always visible from an angle.
  // At high elevation the satellite is directly above the GS — we offset
  // the rotation so the beam cone is seen from the side, not end-on.
  useFrame(() => {
    if (groupRef.current) {
      // Base: center on ground station longitude
      const ty = -props.groundStationLon * DEG2RAD;
      // Add a constant angular offset so the GS is slightly to the side,
      // and the beam sweeps across the viewport instead of going straight down
      const lonOffset = 35 * DEG2RAD; // 35° offset = beam always at angle
      const tx = (props.groundStationLat * 0.4 - 15) * DEG2RAD;
      groupRef.current.rotation.y += ((ty + lonOffset) - groupRef.current.rotation.y) * 0.03;
      groupRef.current.rotation.x += (tx - groupRef.current.rotation.x) * 0.03;
    }
  });

  return (
    <>
      <ambientLight intensity={0.2} />
      <directionalLight position={[5, 3, 4]} intensity={0.6} color="#ddeeff" />
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
          goodput={props.goodput_Mbps}
          health={props.systemHealth}
          elevation={props.elevation_deg}
          beamQuality={props.beamQuality_percent}
          retransmissionRate={props.retransmissionRate}
          packetErrorRate={props.packetErrorRate}
          trackingLocked={props.trackingLocked}
          queueDepth={props.queueDepth_packets}
        />
      </group>
    </>
  );
}

export default function GlobeScene(props: Props) {
  return (
    <div className="w-full h-full relative overflow-hidden" style={{ background: '#030508' }}>
      <Canvas camera={{ position: [0.5, 1.3, 2.0], fov: 50 }} gl={{ antialias: true, alpha: false }}
        style={{ background: '#030508' }}>
        <Scene {...props} />
      </Canvas>
      <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-cyan-900/70 bg-slate-950/75 px-3 py-2 text-[11px] text-slate-200 backdrop-blur-sm">
        <div className="text-cyan-300 uppercase tracking-[0.18em] text-[10px]">Downlink</div>
        <div className="mt-1 flex gap-4">
          <div>
            <div className="text-slate-500">Beam</div>
            <div className={props.trackingLocked ? 'text-emerald-300' : 'text-red-300'}>
              {props.trackingLocked ? 'LOCKED' : 'SEARCHING'}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Beam Q</div>
            <div>{props.beamQuality_percent.toFixed(0)}%</div>
          </div>
          <div>
            <div className="text-slate-500">Queue</div>
            <div>{props.queueDepth_packets.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-slate-500">Retx</div>
            <div>{(props.retransmissionRate * 100).toFixed(1)}%</div>
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute right-4 top-4 max-w-[320px] rounded-xl border border-slate-800/90 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-200 backdrop-blur-sm">
        <div className="text-cyan-300 uppercase tracking-[0.18em] text-[10px]">Hardware State</div>
        <div className="mt-1 text-sm leading-5 text-slate-100">
          {props.statusSummary}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <div>
            <div className="text-slate-500">Track Err</div>
            <div className={props.trackingLocked ? 'text-emerald-300' : 'text-red-300'}>
              {props.trackingError_Hz.toFixed(0)} Hz
            </div>
          </div>
          <div>
            <div className="text-slate-500">EPS Mode</div>
            <div>{props.powerMode}</div>
          </div>
          <div>
            <div className="text-slate-500">Subarrays</div>
            <div>{props.degradedSubarrays} degraded</div>
          </div>
          <div>
            <div className="text-slate-500">Packet Loss</div>
            <div>{(props.packetErrorRate * 100).toFixed(2)}%</div>
          </div>
        </div>
        {props.activeFaultLabels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {props.activeFaultLabels.slice(0, 4).map((fault) => (
              <span key={fault} className="rounded-full border border-amber-800/80 bg-amber-950/40 px-2 py-0.5 text-[10px] text-amber-200">
                {fault}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
