"""
backend/engine/testbed_protocol.py

Generates the actionable three-tier Earth Testbed Protocol:
  1. Macro Field Site deployment guidelines.
  2. Micro Regolith Simulant pairings.
  3. Systemic breakdown diagnostics ("Where the Analogy Breaks Down")
     with physical compensation protocols (gravity offload & TVAC chambers).
"""

from typing import Dict, Any, List


# =====================================================================
# 1. REGOLITH SIMULANT CATALOG & GEOTECHNICAL MAPPING
# =====================================================================
# Standardized NASA / commercial extraterrestrial regolith simulants
SIMULANT_MAPPING = {
    ("Moon", "anorthosite"): {
        "simulant_name": "LHS-1 (Lunar Highland Simulant)",
        "producer": "Exolith Lab / NASA",
        "mineralogy": "Feldspathic anorthosite aggregate (~80% plagioclase)",
        "testing_utility": "Validates drill-bit penetration, abrasive wear on EVA spacesuits, and bucket-wheel torque in highland crust."
    },
    ("Moon", "basalt"): {
        "simulant_name": "JSC-1A / LMS-1 (Lunar Mare Simulant)",
        "producer": "Orbital Technologies / Exolith Lab",
        "mineralogy": "High-titanium basaltic ash and vitric volcanic cinder",
        "testing_utility": "Tests excavation shear resistance, rover wheel sinkage, and basaltic thermal buffering."
    },
    ("Moon", "impact_breccia"): {
        "simulant_name": "LHS-1 with Coarse Anorthositic Clasts",
        "producer": "Custom mechanical mix",
        "mineralogy": "Shattered anorthosite and impact-melt breccia fragments",
        "testing_utility": "Tests rotary-percussive rock-chipping teeth and shock-hardened regolith handling."
    },
    ("Mars", "basalt"): {
        "simulant_name": "MMS-1 / MGS-1 (Mojave / Mars Global Simulant)",
        "producer": "NASA JPL / Exolith Lab",
        "mineralogy": "Crushed basalt enriched in iron oxide and olivine",
        "testing_utility": "Tests pneumatic regolith transport, wheel grouser traction, and dust filter seal integrity."
    },
    ("Mars", "evaporite"): {
        "simulant_name": "MGS-1S (Sulfate-Enriched Mars Simulant)",
        "producer": "Exolith Lab",
        "mineralogy": "Magnesium sulfate and gypsum blended with basaltic ash",
        "testing_utility": "Tests drill-sticking mechanics and hygroscopic crust bonding during volatile sampling."
    },
    ("Mars", "aeolian_dune"): {
        "simulant_name": "MGS-1 Sand Sieve Fraction (<250 µm)",
        "producer": "Exolith Lab",
        "mineralogy": "Fine rounded basaltic grains with low mechanical cohesion",
        "testing_utility": "Evaluates rover wheel slippage, belly-pan drag, and trench wall collapse."
    },
    ("Mars", "phyllosilicate_clay"): {
        "simulant_name": "MGS-1C (Clay-Enriched Mars Simulant)",
        "producer": "Exolith Lab",
        "mineralogy": "Smectite / nontronite clays and iron oxides",
        "testing_utility": "Evaluates rotary-drill sticking, hydration-induced swelling, and core tube ejection."
    }
}

DEFAULT_FALLBACK_SIMULANT = {
    "simulant_name": "NU-LMIX / Commercial Crushed Basalt",
    "producer": "Standard Geotechnical Supplier",
    "mineralogy": "Crushed mafic silicate aggregate",
    "testing_utility": "Provides general baseline abrasion, compaction, and excavation shear testing."
}


# =====================================================================
# 2. EARTH TESTBED PROTOCOL GENERATOR
# =====================================================================
class EarthTestbedProtocolEngine:
    """
    Synthesizes planetary environmental parameters, candidate Earth site conditions,
    and mission requirements into an actionable laboratory and field testing protocol.
    """

    GRAVITY_ACCEL = {
        "Earth": 9.807,
        "Moon": 1.625,   # ~0.166g
        "Mars": 3.721    # ~0.380g
    }

    EARTH_ATM_PRESSURE_PA = 101325.0  # 101.3 kPa

    def generate_protocol(
        self,
        target_profile: Dict[str, Any],
        matched_candidate: Dict[str, Any],
        mission_preset_id: str = "isru_extraction"
    ) -> Dict[str, Any]:
        """
        Builds the three-tier protocol payload.
        
        Parameters:
            target_profile: Dictionary containing body, lat, lon, shared_17, and exclusive dicts.
            matched_candidate: Selected top Earth analog site dictionary.
            mission_preset_id: Operational profile ('rover_mobility', 'isru_extraction', etc.)
        """
        body = target_profile.get("body", "Moon")
        shared = target_profile.get("shared_17", target_profile)
        exclusive = target_profile.get("exclusive", {})

        # -------------------------------------------------------------
        # TIER 1: Macro Field Site Testing Focus
        # -------------------------------------------------------------
        site_name = matched_candidate.get("micro_site_name", matched_candidate.get("site_name", "Analog Site"))
        parent_region = matched_candidate.get("parent_biome", matched_candidate.get("parent_region", "Regional Terrain"))
        
        macro_field_protocol = {
            "analog_site": f"{site_name} ({parent_region})",
            "field_objective": self._determine_field_objective(mission_preset_id, shared),
            "topographic_challenge": (
                f"Slope: {shared.get('mean_slope_deg', 0.0):.1f}° grade | "
                f"Roughness RMS: {shared.get('terrain_roughness_m', 0.0):.2f} m | "
                f"Terrain: {shared.get('terrain_type', 'plain')}"
            )
        }

        # -------------------------------------------------------------
        # TIER 2: Micro Regolith Simulant Pairing
        # -------------------------------------------------------------
        lithology = shared.get("dominant_lithology", "basalt")
        mineral_class = shared.get("surface_mineral_class", "")
        
        lookup_key = (body, "phyllosilicate_clay" if mineral_class == "phyllosilicate_clay" else lithology)
        simulant_info = SIMULANT_MAPPING.get(lookup_key, DEFAULT_FALLBACK_SIMULANT).copy()

        # Cryogenic / ice binder amendment for water-ice regions
        has_ice = shared.get("water_ice_presence", 0) == 1
        ice_fraction = shared.get("surface_ice_fraction_pct", 0.0)
        if has_ice or ice_fraction > 0.0:
            simulant_info["ice_amendment"] = (
                f"Blend dry simulant with {max(5.0, ice_fraction):.1f}% water by mass. "
                "Freeze consolidate at -20°C to -80°C in an insulated cryo-testbox "
                "to replicate cohesive cryogenic permafrost tensile strength."
            )
        else:
            simulant_info["ice_amendment"] = "Oven-bake simulant at 110°C for 24h to remove ambient moisture down to <0.1%."

        # -------------------------------------------------------------
        # TIER 3: Systemic Breakdown Diagnostics ("Where Analogy Breaks Down")
        # -------------------------------------------------------------
        breakdown_diagnostics = []

        # 1. Gravity Mismatch & Cutting Torque Offset
        target_g = self.GRAVITY_ACCEL.get(body, 1.625)
        g_ratio = self.GRAVITY_ACCEL["Earth"] / target_g
        breakdown_diagnostics.append({
            "dimension": "Gravity Differential",
            "planetary_baseline": f"{target_g:.2f} m/s² ({target_g / self.GRAVITY_ACCEL['Earth']:.2f}g)",
            "earth_baseline": f"{self.GRAVITY_ACCEL['Earth']:.2f} m/s² (1.00g)",
            "impact_warning": (
                f"Tool cutting forces, wheel traction, and drill reaction torques are "
                f"{g_ratio:.1f}× higher on Earth than on {body}."
            ),
            "engineering_mitigation": (
                f"Equip prototypes with a {g_ratio:.1f}:1 vertical offload gantry tether or "
                "counterweight crane during mobility and excavation tests to prevent artificial traction benefits."
            )
        })

        # 2. Atmospheric Pressure, Gas Composition & Vacuum Welding
        target_pressure_pa = exclusive.get("surface_atmospheric_pressure_pa", 
                             exclusive.get("mean_atmospheric_pressure_pa", 0.0 if body == "Moon" else 610.0))
        target_atm = exclusive.get("atmosphere_composition", "hard_vacuum" if body == "Moon" else "95%_CO2")

        if body == "Moon":
            breakdown_diagnostics.append({
                "dimension": "Atmospheric Pressure & Regolith Tribology",
                "planetary_baseline": "0.0 Pa (Hard Vacuum)",
                "earth_baseline": "101,325 Pa (1.0 atm Air)",
                "impact_warning": (
                    "Earth's atmospheric air forms protective oxide films on metal surfaces and provides pore air damping. "
                    "In lunar vacuum, bare regolith and mechanical joints exhibit cold-welding and high friction."
                ),
                "engineering_mitigation": (
                    "Seal-wear tests, dust ingress bearings, and volatile extraction drill-bits must be pre-qualified "
                    "inside a Thermal Vacuum (TVAC) chamber (<10⁻⁴ Pa) prior to open-air field trials."
                )
            })
        else:
            breakdown_diagnostics.append({
                "dimension": "Atmospheric Density & Aerodynamics",
                "planetary_baseline": f"{target_pressure_pa:.1f} Pa ({target_atm})",
                "earth_baseline": "101,325 Pa (Standard Air)",
                "impact_warning": (
                    f"Martian atmospheric density is ~{self.EARTH_ATM_PRESSURE_PA / max(1.0, target_pressure_pa):.0f}× "
                    "thinner than Earth's. Rotorcraft aerodynamics, plume dust lofting, and convective heat dissipation differ drastically."
                ),
                "engineering_mitigation": (
                    "Conduct thruster plume interaction and thermal dissipation tests in a hypobaric CO₂ environmental chamber."
                )
            })

        # 3. Body-Exclusive Operational Constraints
        if body == "Moon":
            psr_flag = exclusive.get("permanently_shadowed_region", 0)
            illumination = exclusive.get("solar_illumination_fraction", 0.5)
            trench_depth = exclusive.get("regolith_thickness_m", 4.0)

            if psr_flag == 1:
                breakdown_diagnostics.append({
                    "dimension": "Cryogenic Temperature & Illumination",
                    "planetary_baseline": "Permanent Shadow (0% Sun, <40 K to 100 K)",
                    "earth_baseline": "Diurnal solar exposure at terrestrial test site",
                    "impact_warning": "Terrestrial field sites cannot replicate lunar cryogenic cold traps (<100 K).",
                    "engineering_mitigation": "Equip cutting heads with liquid nitrogen (LN2) cooling loops; battery systems require internal thermal insulation validation."
                })
            else:
                breakdown_diagnostics.append({
                    "dimension": "Solar Array Budget & Illumination",
                    "planetary_baseline": f"{illumination * 100:.1f}% Solar Illumination Fraction",
                    "earth_baseline": "Day/night cycling with atmospheric sunlight attenuation",
                    "impact_warning": "Lunar polar rims experience continuous grazing sunlight without atmospheric diffuse scattering.",
                    "engineering_mitigation": "Calibrate horizontal solar arrays using low-incident-angle collimated solar simulators."
                })

            breakdown_diagnostics.append({
                "dimension": "Regolith Depth & Bedrock Boundary",
                "planetary_baseline": f"Estimated Regolith Thickness: {trench_depth:.1f} m",
                "earth_baseline": "Variable soil-to-bedrock horizon depth",
                "impact_warning": f"Loose impact regolith extends {trench_depth:.1f} m before encountering competent basement rock.",
                "engineering_mitigation": f"Excavate a test trench at least {min(trench_depth, 3.0):.1f} m deep packed with simulant to avoid premature bedrock contact."
            })

        elif body == "Mars":
            co2_ice = exclusive.get("seasonal_co2_ice_presence", 0)
            hydrated = exclusive.get("hydrated_mineral_presence", 0)

            if co2_ice == 1:
                breakdown_diagnostics.append({
                    "dimension": "Seasonal Carbon Dioxide Frost",
                    "planetary_baseline": "Dry ice (CO₂ slab) deposition present seasonally",
                    "earth_baseline": "Terrestrial winter ice is strictly H₂O",
                    "impact_warning": "CO₂ ice sublimates rapidly at terrestrial ambient pressure and temperature.",
                    "engineering_mitigation": "Simulate surface crust mechanics using dry ice blocks under controlled hypobaric conditions."
                })

            if hydrated == 1:
                breakdown_diagnostics.append({
                    "dimension": "Aqueous Clay & Sulfate Hydration",
                    "planetary_baseline": "Phyllosilicate clays / hydrated sulfates detected by orbital spectroscopy",
                    "earth_baseline": "Standard silica/basalt sand matrix",
                    "impact_warning": "Hydrated clays cause rotary drill clogging and tool gumming.",
                    "engineering_mitigation": "Amend MMS-1/MGS-1 simulant with 15% bentonite or nontronite clay to evaluate drill-bit jamming."
                })

        # -------------------------------------------------------------
        # Unified Protocol Payload
        # -------------------------------------------------------------
        return {
            "target_body": body,
            "target_coordinates": {"lat": target_profile.get("lat"), "lon": target_profile.get("lon")},
            "macro_field_site": macro_field_protocol,
            "micro_regolith_simulant": simulant_info,
            "where_analogy_breaks_down": breakdown_diagnostics,
            "primary_mismatch": breakdown_diagnostics[1]["dimension"],
            "mitigation_summary": breakdown_diagnostics[0]["engineering_mitigation"]
        }

    def _determine_field_objective(self, mission_id: str, shared: Dict[str, Any]) -> str:
        if mission_id == "rover_mobility":
            return "Validate chassis suspension, wheel slip ratio, grouser traction, and rollover thresholds."
        elif mission_id == "isru_extraction":
            return "Validate rotary-percussive drill-bit wear, excavation bucket-wheel torque, and regolith transport."
        elif mission_id == "subsurface_habitat":
            return "Evaluate cave ingress robotics, LIDAR dark navigation, RF signal attenuation, and roof arch stability."
        elif mission_id == "thermal_power_survival":
            return "Test solar array thermal cycling fatigue, dust deposition attenuation, and battery thermal regulation."
        elif mission_id == "eva_dust_operations":
            return "Benchmark astronaut EVA suit joint torque resistance, boot grip on slopes, and regolith dust seal abrasion."
        return "Conduct multi-criteria surface mobility and geotechnical hardware validation."


# =====================================================================
# 3. VERIFICATION & SAMPLE EXECUTION
# =====================================================================
if __name__ == "__main__":
    from pprint import pprint

    protocol_engine = EarthTestbedProtocolEngine()

    # Mock resolved targets from moon_resolver / mars_resolver
    mock_moon_target = {
        "body": "Moon",
        "lat": -89.90,
        "lon": 0.00,
        "shared_17": {
            "mean_slope_deg": 5.4,
            "terrain_roughness_m": 0.85,
            "terrain_type": "crater_rim",
            "dominant_lithology": "anorthosite",
            "surface_mineral_class": "feldspar",
            "water_ice_presence": 1,
            "surface_ice_fraction_pct": 12.0,
        },
        "exclusive": {
            "permanently_shadowed_region": 1,
            "solar_illumination_fraction": 0.85,
            "regolith_thickness_m": 11.0,
            "surface_atmospheric_pressure_pa": 0.0,
            "atmosphere_composition": "hard_vacuum"
        }
    }

    mock_earth_candidate = {
        "micro_site_name": "Haughton Impact Crater Floor",
        "parent_biome": "Devon Island, High Arctic, Canada"
    }

    protocol = protocol_engine.generate_protocol(
        target_profile=mock_moon_target,
        matched_candidate=mock_earth_candidate,
        mission_preset_id="isru_extraction"
    )

    print("=== GENERATED EARTH TESTBED PROTOCOL ===")
    pprint(protocol)