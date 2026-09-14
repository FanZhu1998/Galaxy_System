// Units: kpc, Myr, km/s, AU, years, and solar masses as indicated.
// Fixed galactic potential: Hernquist baryonic component + spherical logarithmic halo + central point mass.
// https://adsabs.harvard.edu/pdf/1990ApJ...356..359H
// https://docs.galpy.org/en/latest/reference/potentialloghalo.html
// Kepler geometry: https://ssd.jpl.nasa.gov/planets/approx_pos.html
export const TAU = Math.PI * 2;
export const G_GAL = 4.30091e-6;
export const KM_S_TO_KPC_MYR = 0.001022712165;
export const G_AU = 4 * Math.PI * Math.PI;
export const AU_YR_TO_KM_S = 4.74047046;
export const GALAXY = Object.freeze({ mass: 6e10, scale: 3, haloSpeed: 180, haloCore: 5, blackHole: 4.3e6 });

export function circularSpeed(radius) {
  return Math.sqrt(
    G_GAL * GALAXY.mass * radius / (radius + GALAXY.scale) ** 2 +
    GALAXY.haloSpeed ** 2 * radius ** 2 / (radius ** 2 + GALAXY.haloCore ** 2) +
    G_GAL * GALAXY.blackHole / radius
  );
}

export const angularRate = radius => circularSpeed(radius) / radius * KM_S_TO_KPC_MYR;

export function solveKepler(meanAnomaly, eccentricity) {
  let eccentricAnomaly = meanAnomaly;
  for (let iteration = 0; iteration < 8; iteration++) {
    const correction = (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly) /
      (1 - eccentricity * Math.cos(eccentricAnomaly));
    eccentricAnomaly -= correction;
    if (Math.abs(correction) < 1e-12) break;
  }
  return eccentricAnomaly;
}
