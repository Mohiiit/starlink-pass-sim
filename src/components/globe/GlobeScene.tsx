'use client';

import { useRef, useMemo, useEffect, forwardRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
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

// ═══════════════════════════════════════
// EARTH
// ═══════════════════════════════════════
const atmosphereVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-viewPos.xyz);
    gl_Position = projectionMatrix * viewPos;
  }
`;
const atmosphereFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float fresnel = 1.0 - dot(vNormal, vViewDir);
    fresnel = pow(fresnel, 5.0);
    gl_FragColor = vec4(0.15, 0.55, 1.0, fresnel * 0.2);
  }
`;

function Earth() {
  return (
    <group>
      {/* Solid globe */}
      <mesh>
        <sphereGeometry args={[EARTH_R, 64, 64]} />
        <meshPhongMaterial color="#0c1830" emissive="#060c1a" shininess={3} />
      </mesh>
      {/* Grid lines (30° spacing) */}
      <mesh>
        <sphereGeometry args={[EARTH_R + 0.002, 12, 6]} />
        <meshBasicMaterial color="#2a6aaa" wireframe transparent opacity={0.2} />
      </mesh>
      {/* Finer sub-grid */}
      <mesh>
        <sphereGeometry args={[EARTH_R + 0.001, 36, 18]} />
        <meshBasicMaterial color="#1a4060" wireframe transparent opacity={0.07} />
      </mesh>
      {/* Atmosphere - Fresnel glow */}
      <mesh>
        <sphereGeometry args={[EARTH_R + 0.06, 64, 64]} />
        <shaderMaterial
          vertexShader={atmosphereVertexShader}
          fragmentShader={atmosphereFragmentShader}
          transparent
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// ═══════════════════════════════════════
// GROUND STATION
// ═══════════════════════════════════════
function GroundStation({ lat, lon }: { lat: number; lon: number }) {
  const pos = useMemo(() => geo2vec(lat, lon, EARTH_R + 0.006), [lat, lon]);
  const normal = useMemo(() => pos.clone().normalize(), [pos]);
  const ringRef = useRef<THREE.Mesh>(null!);

  // Orient the ring to lay flat on the surface
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    return q;
  }, [normal]);

  useFrame(({ clock }) => {
    if (ringRef.current) {
      const s = 1 + 0.3 * Math.sin(clock.elapsedTime * 2.5);
      ringRef.current.scale.set(s, s, s);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = 0.5 - 0.3 * Math.sin(clock.elapsedTime * 2.5);
    }
  });

  return (
    <group position={pos}>
      {/* Station dot */}
      <mesh>
        <sphereGeometry args={[0.014, 16, 16]} />
        <meshBasicMaterial color="#22c55e" />
      </mesh>
      {/* Pulse ring */}
      <mesh ref={ringRef} quaternion={quaternion}>
        <ringGeometry args={[0.025, 0.032, 32]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Outer ring */}
      <mesh quaternion={quaternion}>
        <ringGeometry args={[0.04, 0.044, 32]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.15} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ═══════════════════════════════════════
// SATELLITE
// ═══════════════════════════════════════
function Satellite({ lat, lon, health }: { lat: number; lon: number; health: string }) {
  const pos = useMemo(() => geo2vec(lat, lon, SAT_R), [lat, lon]);
  const color = useMemo(() => healthColor(health), [health]);
  const glowRef = useRef<THREE.Mesh>(null!);
  const lightRef = useRef<THREE.PointLight>(null!);

  useFrame(({ clock }) => {
    if (glowRef.current) {
      const s = 1 + 0.25 * Math.sin(clock.elapsedTime * 3);
      glowRef.current.scale.setScalar(s);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.05 * Math.sin(clock.elapsedTime * 3);
    }
    if (lightRef.current) {
      lightRef.current.intensity = 0.6 + 0.2 * Math.sin(clock.elapsedTime * 3);
    }
  });

  return (
    <group position={pos}>
      {/* Satellite body */}
      <mesh>
        <boxGeometry args={[0.032, 0.008, 0.018]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {/* Solar panels */}
      <mesh position={[0.038, 0, 0]}>
        <boxGeometry args={[0.035, 0.003, 0.016]} />
        <meshBasicMaterial color="#1a3a70" emissive="#0a1530" />
      </mesh>
      <mesh position={[-0.038, 0, 0]}>
        <boxGeometry args={[0.035, 0.003, 0.016]} />
        <meshBasicMaterial color="#1a3a70" emissive="#0a1530" />
      </mesh>
      {/* Inner glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.18} depthWrite={false} />
      </mesh>
      {/* Outer glow */}
      <mesh>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.06} depthWrite={false} />
      </mesh>
      {/* Point light */}
      <pointLight ref={lightRef} color={color} intensity={1.2} distance={0.8} decay={2} />
    </group>
  );
}

// ═══════════════════════════════════════
// ORBIT PATH
// ═══════════════════════════════════════
function OrbitPath({ path, currentIndex }: { path: [number, number][]; currentIndex: number }) {
  const pastPoints = useMemo(() => {
    const start = Math.max(0, currentIndex - 80);
    return path.slice(start, currentIndex + 1).map(([lon, lat]) => geo2vec(lat, lon, SAT_R));
  }, [path, currentIndex]);

  const futurePoints = useMemo(() => {
    const end = Math.min(path.length, currentIndex + 80);
    return path.slice(currentIndex, end).map(([lon, lat]) => geo2vec(lat, lon, SAT_R));
  }, [path, currentIndex]);

  return (
    <group>
      {pastPoints.length > 1 && (
        <Line points={pastPoints} color="#00e5ff" lineWidth={2} transparent opacity={0.35} />
      )}
      {futurePoints.length > 1 && (
        <Line points={futurePoints} color="#00e5ff" lineWidth={1} transparent opacity={0.1}
          dashed dashSize={0.015} gapSize={0.015} />
      )}
    </group>
  );
}

// ═══════════════════════════════════════
// PARTICLE POINTS HELPER
// ═══════════════════════════════════════
const ParticlePoints = forwardRef<THREE.Points, { maxCount: number; posArray: Float32Array; color: THREE.Color }>(
  function ParticlePoints({ maxCount, posArray, color }, ref) {
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
        <pointsMaterial size={0.018} color={color} transparent opacity={0.9} sizeAttenuation depthWrite={false} />
      </points>
    );
  },
);

// ═══════════════════════════════════════
// BEAM + DATA PARTICLES
// ═══════════════════════════════════════
function DataBeam({ satLat, satLon, gsLat, gsLon, goodput, health, elevation }: {
  satLat: number; satLon: number; gsLat: number; gsLon: number;
  goodput: number; health: string; elevation: number;
}) {
  const satPos = useMemo(() => geo2vec(satLat, satLon, SAT_R), [satLat, satLon]);
  const gsPos = useMemo(() => geo2vec(gsLat, gsLon, EARTH_R + 0.006), [gsLat, gsLon]);
  const color = useMemo(() => healthColor(health), [health]);

  const beamConeRef = useRef<THREE.Mesh>(null!);
  const coreLineRef = useRef<THREE.Mesh>(null!);

  // Beam cone geometry — narrow at satellite, wider at ground
  const { conePos, coneQuat, coneLength } = useMemo(() => {
    const mid = satPos.clone().add(gsPos).multiplyScalar(0.5);
    const dir = gsPos.clone().sub(satPos);
    const len = dir.length();
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return { conePos: mid, coneQuat: q, coneLength: len };
  }, [satPos, gsPos]);

  // Data particles
  const MAX_PARTICLES = 60;
  const particlesRef = useRef<THREE.Points>(null!);
  const particleData = useRef<{ progress: number; speed: number }[]>([]);
  const posArray = useRef(new Float32Array(MAX_PARTICLES * 3));

  useFrame(({ clock }) => {
    // Beam pulse
    if (beamConeRef.current) {
      const pulse = 0.06 + 0.03 * Math.sin(clock.elapsedTime * 4);
      const flicker = health === 'critical' ? (Math.sin(clock.elapsedTime * 20) > -0.3 ? 1 : 0.1) : 1;
      (beamConeRef.current.material as THREE.MeshBasicMaterial).opacity = pulse * flicker;
    }

    // Particles
    if (goodput > 0 && elevation > 0) {
      const rate = Math.min(2.5, goodput / 100);
      if (particleData.current.length < MAX_PARTICLES && Math.random() < rate * 0.5) {
        particleData.current.push({ progress: 0, speed: 0.008 + Math.random() * 0.007 });
      }

      let alive = 0;
      const arr = posArray.current;
      particleData.current = particleData.current.filter(p => {
        p.progress += p.speed;
        if (p.progress >= 1) return false;
        const x = satPos.x + (gsPos.x - satPos.x) * p.progress;
        const y = satPos.y + (gsPos.y - satPos.y) * p.progress;
        const z = satPos.z + (gsPos.z - satPos.z) * p.progress;
        arr[alive * 3] = x;
        arr[alive * 3 + 1] = y;
        arr[alive * 3 + 2] = z;
        alive++;
        return true;
      });

      if (particlesRef.current) {
        const attr = particlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
        attr.needsUpdate = true;
        particlesRef.current.geometry.setDrawRange(0, alive);
      }
    } else {
      particleData.current = [];
      if (particlesRef.current) {
        particlesRef.current.geometry.setDrawRange(0, 0);
      }
    }
  });

  if (elevation <= 0 || goodput <= 0) return null;

  return (
    <group>
      {/* Beam cone (narrow at sat, wider at ground) */}
      <mesh ref={beamConeRef} position={conePos} quaternion={coneQuat}>
        <cylinderGeometry args={[0.006, 0.035, coneLength, 16, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* Core beam line */}
      <Line points={[satPos, gsPos]} color={color} lineWidth={2.5} transparent opacity={0.6} />

      {/* Data particles */}
      <ParticlePoints ref={particlesRef} maxCount={MAX_PARTICLES} posArray={posArray.current} color={color} />
    </group>
  );
}

// ═══════════════════════════════════════
// SCENE ORCHESTRATOR
// ═══════════════════════════════════════
function Scene(props: Props) {
  const groupRef = useRef<THREE.Group>(null!);

  // Auto-rotate globe to keep satellite visible
  useFrame(() => {
    if (groupRef.current) {
      const targetY = -props.satelliteLon * DEG2RAD;
      const targetX = props.satelliteLat * DEG2RAD * 0.3;
      groupRef.current.rotation.y += (targetY - groupRef.current.rotation.y) * 0.03;
      groupRef.current.rotation.x += (targetX - groupRef.current.rotation.x) * 0.03;
    }
  });

  return (
    <>
      <ambientLight intensity={0.15} />
      <directionalLight position={[5, 3, 4]} intensity={0.4} color="#aaccff" />
      <Stars radius={50} depth={40} count={3000} factor={3} saturation={0.2} fade speed={0.5} />

      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={1.8}
        maxDistance={6}
        enablePan={false}
        rotateSpeed={0.5}
      />

      <group ref={groupRef}>
        <Earth />
        <GroundStation lat={props.groundStationLat} lon={props.groundStationLon} />
        <OrbitPath path={props.orbitPath} currentIndex={props.currentIndex} />
        <Satellite lat={props.satelliteLat} lon={props.satelliteLon} health={props.systemHealth} />
        <DataBeam
          satLat={props.satelliteLat} satLon={props.satelliteLon}
          gsLat={props.groundStationLat} gsLon={props.groundStationLon}
          goodput={props.goodput_Mbps} health={props.systemHealth}
          elevation={props.elevation_deg}
        />
      </group>
    </>
  );
}

// ═══════════════════════════════════════
// CANVAS WRAPPER (exported as default for dynamic import)
// ═══════════════════════════════════════
export default function GlobeScene(props: Props) {
  return (
    <div className="w-full h-full" style={{ background: '#030508' }}>
      <Canvas
        camera={{ position: [0, 0.6, 2.8], fov: 45 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#030508' }}
      >
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
