// Physical and system constants for Starlink Ku-band simulation

// Fundamental constants
export const SPEED_OF_LIGHT = 299792458; // m/s
export const BOLTZMANN_K = 1.380649e-23; // J/K
export const BOLTZMANN_K_DBW = -228.6; // dBW/K/Hz
export const STEFAN_BOLTZMANN = 5.670374419e-8; // W/m²/K⁴
export const EARTH_RADIUS_KM = 6371; // km
export const EARTH_MU = 398600.4418; // km³/s² (gravitational parameter)

// Starlink Ku-band downlink parameters
export const DOWNLINK_FREQ_HZ = 12e9; // 12 GHz center
export const DOWNLINK_WAVELENGTH_M = SPEED_OF_LIGHT / DOWNLINK_FREQ_HZ; // ~0.025 m
export const CHANNEL_BANDWIDTH_HZ = 250e6; // 250 MHz

// Phased array parameters (Starlink v1.5 estimated)
export const TOTAL_ELEMENTS = 1200;
export const ELEMENT_SPACING_M = DOWNLINK_WAVELENGTH_M / 2; // λ/2
export const ELEMENT_MAX_GAIN_DBI = 5.0;
export const ELEMENT_PATTERN_EXPONENT = 1.35; // cos^q rolloff
export const TAPER_EFFICIENCY = 0.85; // Taylor taper for sidelobe control
export const MAX_SCAN_ANGLE_DEG = 70; // beyond this, beam is unusable

// Power amplifier (GaN MMIC)
export const PA_SMALL_SIGNAL_GAIN_DB = 30;
export const PA_P_SAT_DBM = 35; // 3.2W
export const PA_P1DB_DBM = 33; // 2W
export const PA_RAPP_P = 2; // smoothness factor
export const PA_AMPM_ALPHA_DEG = 37; // max AM/PM at saturation
export const PA_NOMINAL_BACKOFF_DB = 4; // default operating backoff
export const PA_EFF_AT_SAT = 0.45; // DC-to-RF efficiency at saturation

// PA thermal derating
export const PA_P1DB_DERATING_DB_PER_C = 0.02; // above 25°C
export const PA_GAIN_DERATING_DB_PER_C = 0.015;
export const PA_EFF_DERATING_PER_C = 0.003;
export const PA_THERMAL_THROTTLE_MILD_C = 85;
export const PA_THERMAL_THROTTLE_SEVERE_C = 95;
export const PA_THERMAL_THROTTLE_EXTRA_BACKOFF_DB = 2;

// Oscillator (TCXO)
export const OSC_NOMINAL_FREQ_HZ = DOWNLINK_FREQ_HZ;
export const OSC_DRIFT_ALPHA_PPM_PER_C = 0.5; // linear coefficient
export const OSC_DRIFT_BETA_PPM_PER_C2 = 0.01; // quadratic coefficient
export const OSC_UNLOCK_TEMP_C = 80; // PLL may lose lock above this

// Thermal model node parameters
export const THERMAL_REF_TEMP_C = 25; // reference temperature for derating
export const SPACE_TEMP_K = 3; // cosmic microwave background
export const EARTH_TEMP_K = 255; // effective Earth temperature
export const SOLAR_CONSTANT_W_M2 = 1361;

// Ground station (Starlink consumer dish)
export const GS_ANTENNA_GAIN_DBI = 34; // ~0.5m dish
export const GS_LNA_NOISE_TEMP_K = 75;
export const GS_CABLE_NOISE_TEMP_K = 20;
export const GS_ANTENNA_NOISE_TEMP_ZENITH_K = 30;
export const GS_ANTENNA_NOISE_TEMP_HORIZON_K = 230;

// Link budget
export const FEED_LOSS_DB = 1.5;
export const IMPLEMENTATION_LOSS_DB = 2.0;
export const ATMOSPHERIC_LOSS_ZENITH_DB = 0.2; // clear sky at 12 GHz

// Protocol
export const PACKET_SIZE_BYTES = 1500;
export const PACKET_SIZE_BITS = PACKET_SIZE_BYTES * 8;
export const MAX_RETRANSMISSIONS = 4;
export const FRAME_OVERHEAD_FRACTION = 0.10; // headers + pilots + guard

// Elevation mask
export const ELEVATION_MASK_DEG = 25;

// Satellite altitude
export const STARLINK_ALTITUDE_KM = 550;

// Default ground station: Redmond, WA (near SpaceX ground station)
export const DEFAULT_GROUND_STATION = {
  name: 'Redmond, WA',
  lat: 47.674,
  lon: -122.121,
  alt: 0.01, // km above sea level
};

// Real Starlink TLE — STARLINK-1008 (NORAD 44714)
// Fetched from CelesTrak on 2026-04-11. 53° inclination, ~540 km altitude.
export const DEFAULT_TLE = {
  line1: '1 44714U 19074B   26101.18331139  .00044052  00000+0  13020-2 0  9992',
  line2: '2 44714  53.1549  27.2699 0003259 140.0923 220.0320 15.34524170353857',
};
