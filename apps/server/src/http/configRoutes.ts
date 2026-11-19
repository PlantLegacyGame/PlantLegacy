import { readConfigValues, readFlatConfig } from '../ops/configRoutes.ts';

export interface ConfigResponse {
  status: number;
  body: unknown;
}

/**
 * The `/config/*` routes: the client's read-only view of `config/*.json`.
 *
 * Lifted out of the request handler as one function of `(url, configDir)`. Each
 * route keeps its own shaping and its own fallback defaults — the client depends
 * on those shapes — but none of them needs the world, the socket or the accounts.
 * Returns null for a path it does not serve, so the caller can answer 404.
 */
export async function handleConfigRequest(
  url: URL,
  configDir: string,
): Promise<ConfigResponse | null> {
  if (url.pathname === '/config/onboarding') {
    // T00A: Serve onboarding config
    try {
      // Extract values from extended-1 format
      const values = await readConfigValues(configDir, 'onboarding');
      if (!values) throw new Error('onboarding.json unreadable');
      const hintCardLines = values.hint_card_lines?.value || [
        'WASD / Arrows: Pan camera  |  Left-drag: Orbit  |  Middle-drag: Pan  |  Scroll: Zoom',
        'Click node: Focus  |  G: Toggle Grow Mode  |  R: Root Sight  |  E: Emotes  |  I: Inventory',
        'You are a plant. Grow roots down, canopy up. Read light, water, minerals.',
      ];
      const showHintCardDurationMs = values.show_hint_card_duration_ms?.value || 10000;
      const resourceTooltips = values.resource_tooltips?.value || {
        light: 'Light: canopy exposure. Higher = faster photosynthesis.',
        water: 'Water: root access to moisture. Depletes near other roots.',
        minerals: 'Minerals: root access to nutrients. Concentrated in soil layers.',
      };

      return {
        status: 200,
        body: {
          hint_card_lines: hintCardLines,
          show_hint_card_duration_ms: showHintCardDurationMs,
          resource_tooltips: resourceTooltips,
        },
      };
    } catch {
      // Fallback to defaults
      return {
        status: 200,
        body: {
          hint_card_lines: [
            'WASD / Arrows: Move  |  Mouse: Orbit camera  |  Scroll: Zoom',
            'You are a plant. Grow roots down, canopy up. Read light, water, minerals.',
            'Other players are other plants. Compete, ally, or parasitize. The world simulates offline.',
          ],
          show_hint_card_duration_ms: 10000,
          resource_tooltips: {
            light: 'Light: canopy exposure. Higher = faster photosynthesis.',
            water: 'Water: root access to moisture. Depletes near other roots.',
            minerals: 'Minerals: root access to nutrients. Concentrated in soil layers.',
          },
        },
      };
    }
  }

  if (url.pathname === '/config/plant_renderer') {
    // T01: Serve plant renderer config
    try {
      // Extract values from extended-1 format
      const values = await readConfigValues(configDir, 'plant_renderer');
      if (!values) throw new Error('plant_renderer.json unreadable');
      const plantRendererConfig = {
        max_nodes_per_plant: values.max_nodes_per_plant?.value ?? 1000,
        root_max_depth: values.root_max_depth?.value ?? 50.0,
        canopy_max_height: values.canopy_max_height?.value ?? 50.0,
        node_spacing_min: values.node_spacing_min?.value ?? 0.5,
        node_spacing_max: values.node_spacing_max?.value ?? 2.0,
        branch_probability: values.branch_probability?.value ?? 0.15,
        canopy_sight_enabled: values.canopy_sight_enabled?.value ?? true,
        photosynthesis_visualization: values.photosynthesis_visualization?.value ?? true,
        water_flow_visualization: values.water_flow_visualization?.value ?? true,
        nutrient_flow_visualization: values.nutrient_flow_visualization?.value ?? true,
        shader_quality: values.shader_quality?.value ?? 'high',
        max_gpu_buffers: values.max_gpu_buffers?.value ?? 8,
        compute_shader_workgroup_size: values.compute_shader_workgroup_size?.value ?? 64,
        tube_length_segments: values.tube_length_segments?.value ?? 8,
        leaf_count_per_node: values.leaf_count_per_node?.value ?? 1,
        leaf_size: values.leaf_size?.value ?? 0.25,
        leaf_length_width_ratio: values.leaf_length_width_ratio?.value ?? 2.5,
        petiole_length: values.petiole_length?.value ?? 0.25,
        petiole_thickness: values.petiole_thickness?.value ?? 0.015,
        l0_distance: values.l0_distance?.value ?? 50.0,
        l1_distance: values.l1_distance?.value ?? 150.0,
        l2_distance: values.l2_distance?.value ?? 500.0,
        triangle_budget_l0: values.triangle_budget_l0?.value ?? 1500,
        triangle_budget_l1: values.triangle_budget_l1?.value ?? 800,
        wind_strength: values.wind_strength?.value ?? 0.3,
        wind_speed: values.wind_speed?.value ?? 1.0,
        health_tint_strength: values.health_tint_strength?.value ?? 0.5,
        mutation_visual_0_param: values.mutation_visual_0_param?.value ?? 0.0,
        mutation_visual_1_param: values.mutation_visual_1_param?.value ?? 1.5,
        mutation_visual_2_param: values.mutation_visual_2_param?.value ?? 0.3,
        smin_blend_radius: values.smin_blend_radius?.value ?? 0.25,
        max_raymarch_steps: values.max_raymarch_steps?.value ?? 32,
        raymarch_hit_epsilon: values.raymarch_hit_epsilon?.value ?? 0.005,
        bounding_box_padding: values.bounding_box_padding?.value ?? 1.2,
      };

      // Every entry in the file rides along. This route used to send only the
      // names it listed, and those names are mostly not the file's: the client
      // asks this payload for `l0_raymarch_steps`, `mesh_tube_radial_segments`
      // and the rest of the SDF/mesh tessellation, none of which were here, so
      // a whole tier of drawn detail ignored the config. The listed values stay
      // on top because some of them (the plan-wide spacing/limit names) have no
      // entry in this file yet.
      const flat: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(values)) {
        flat[key] = (entry as { value?: unknown }).value;
      }
      return { status: 200, body: { ...flat, ...plantRendererConfig } };
    } catch {
      // Fallback to defaults
      return {
        status: 200,
        body: {
          max_nodes_per_plant: 1000,
          root_max_depth: 50.0,
          canopy_max_height: 50.0,
          node_spacing_min: 0.5,
          node_spacing_max: 2.0,
          branch_probability: 0.15,
          canopy_sight_enabled: true,
          photosynthesis_visualization: true,
          water_flow_visualization: true,
          nutrient_flow_visualization: true,
          shader_quality: 'high',
          max_gpu_buffers: 8,
          compute_shader_workgroup_size: 64,
          tube_length_segments: 8,
          leaf_count_per_node: 1,
          leaf_size: 0.25,
          leaf_length_width_ratio: 2.5,
          petiole_length: 0.25,
          petiole_thickness: 0.015,
          l0_distance: 50.0,
          l1_distance: 150.0,
          l2_distance: 500.0,
          triangle_budget_l0: 1500,
          triangle_budget_l1: 800,
          wind_strength: 0.3,
          wind_speed: 1.0,
          health_tint_strength: 0.5,
          mutation_visual_0_param: 0.0,
          mutation_visual_1_param: 1.5,
          mutation_visual_2_param: 0.3,
          smin_blend_radius: 0.25,
          max_raymarch_steps: 32,
          raymarch_hit_epsilon: 0.005,
          bounding_box_padding: 1.2,
        },
      };
    }
  }

  if (url.pathname === '/config/growth') {
    // Growth step distances, so the aim arrow can preview exactly one real
    // segment instead of an invented length.
    try {
      const parsed = { values: await readConfigValues(configDir, 'growth') };
      if (!parsed.values) throw new Error('growth.json unreadable');
      const values = (parsed.values ?? {}) as Record<
        string,
        {
          value?: {
            segment_length?: number;
            biomass_cost?: number;
            growth_time_seconds?: number;
          };
        }
      >;
      // Per-type step distances, so the aim preview is the segment that will
      // actually be grown (a cotyledon is 0.1 m, not a 0.95 m canopy step).
      // Costs and growth times ride along for Plant Lab's economy readout.
      const nodeLengths: Record<string, number> = {};
      const nodeCosts: Record<string, number> = {};
      const nodeGrowthSeconds: Record<string, number> = {};
      for (const [key, entry] of Object.entries(values)) {
        if (!key.endsWith('_node')) continue;
        const type = key.replace(/_node$/, '');
        const length = entry?.value?.segment_length;
        const cost = entry?.value?.biomass_cost;
        const seconds = entry?.value?.growth_time_seconds;
        if (typeof length === 'number') nodeLengths[type] = length;
        if (typeof cost === 'number') nodeCosts[type] = cost;
        if (typeof seconds === 'number') nodeGrowthSeconds[type] = seconds;
      }
      // Organism geometry rides along: the seed aspect, radius table and
      // branch attach fraction are the numbers the client needs to draw and
      // aim the same plant the server grows.
      const geometryNumber = (key: string, fallback: number): number => {
        const value = parsed.values?.[key]?.value;
        return typeof value === 'number' ? value : fallback;
      };
      return {
        status: 200,
        body: {
          root_growth_speed: values.root_growth_speed?.value ?? 0.85,
          canopy_growth_speed: values.canopy_growth_speed?.value ?? 0.95,
          node_lengths: nodeLengths,
          node_costs: nodeCosts,
          node_growth_seconds: nodeGrowthSeconds,
          seed_body_height_ratio: geometryNumber('seed_body_height_ratio', 1.35),
          branch_attach_fraction: geometryNumber('branch_attach_fraction', 0.6),
          joint_flare_ratio: geometryNumber('joint_flare_ratio', 1.25),
          segment_taper_exponent: geometryNumber('segment_taper_exponent', 2.2),
          socket_inset_ratio: geometryNumber('socket_inset_ratio', 0.15),
          node_radius_profiles: parsed.values?.node_radius_profiles?.value ?? {},
        },
      };
    } catch {
      return {
        status: 200,
        body: {
          root_growth_speed: 0.85,
          canopy_growth_speed: 0.95,
          node_lengths: {},
          node_costs: {},
          node_growth_seconds: {},
          seed_body_height_ratio: 1.35,
          branch_attach_fraction: 0.6,
          joint_flare_ratio: 1.25,
          segment_taper_exponent: 2.2,
          socket_inset_ratio: 0.15,
          node_radius_profiles: {},
        },
      };
    }
  }

  if (url.pathname === '/config/render') {
    // C01: Serve render config
    try {
      const values = await readConfigValues(configDir, 'render');
      if (!values) throw new Error('render.json unreadable');
      const renderConfig: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(values)) {
        renderConfig[key] =
          (entry as { value?: unknown })?.value !== undefined
            ? (entry as { value: unknown }).value
            : entry;
      }

      return { status: 200, body: renderConfig };
    } catch {
      return {
        status: 200,
        body: {
          target_fps: 60,
          fps_warning_threshold: 0.85,
          resolution_floor: 0.25,
          max_pixel_ratio: 2.0,
          camera_smoothing: 0.05,
          camera_min_distance: 10.0,
          camera_max_distance: 200.0,
          camera_max_polar_angle: 1.52,
          idle_drop_timeout_ms: 30000,
          shadow_map_size: 2048,
          debug_overlay_enabled: true,
          pause_on_hidden: true,
          quality_tiers: [
            {
              name: 'low',
              pixel_ratio: 1.0,
              shadow_map_size: 1024,
              max_triangles: 50000,
              antialiasing: false,
            },
            {
              name: 'medium',
              pixel_ratio: 1.5,
              shadow_map_size: 2048,
              max_triangles: 200000,
              antialiasing: true,
            },
            {
              name: 'high',
              pixel_ratio: 2.0,
              shadow_map_size: 2048,
              max_triangles: 500000,
              antialiasing: true,
            },
          ],
        },
      };
    }
  }

  // Systems the client reads verbatim: day/night timing and tile ranges.
  // Anything else with a dedicated route below keeps its own handler.
  if (url.pathname === '/config/daynight' || url.pathname === '/config/resources') {
    const system = url.pathname.slice('/config/'.length);
    const flat = await readFlatConfig(configDir, system);
    return { status: 200, body: flat ?? {} };
  }

  if (url.pathname === '/config/controls') {
    // C01: Serve controls config
    try {
      const values = await readConfigValues(configDir, 'controls');
      if (!values) throw new Error('controls.json unreadable');
      const bindingsArray = (values.bindings_desktop?.value ?? []) as Array<{ action?: string }>;
      const bindingsObj: Record<string, unknown> = {};
      for (const b of bindingsArray) {
        if (b.action) bindingsObj[b.action] = b;
      }
      const controlsConfig = {
        bindings: bindingsObj,
        touch_min_target_px: values.touch_min_target_px?.value ?? 44,
        hud_max_screen_fraction: values.hud_max_screen_fraction?.value ?? 0.2,
        root_sight_mode: values.root_sight_mode?.value ?? 'toggle',
        text_scale: values.text_scale?.value ?? 1.0,
        context_dock_fade_ms: values.context_dock_fade_ms?.value ?? 150,
      };

      return { status: 200, body: controlsConfig };
    } catch {
      // Default bindings matching config/controls.json
      const defaultBindings: Record<string, unknown> = {
        camera_orbit: {
          action: 'camera_orbit',
          keys: [],
          mouse: 'left_drag',
          mode: 'hold',
          context: '',
        },
        camera_pan: {
          action: 'camera_pan',
          keys: [],
          mouse: 'right_drag',
          mode: 'hold',
          context: '',
        },
        camera_pan_forward: {
          action: 'camera_pan_forward',
          keys: ['KeyW', 'ArrowUp'],
          mouse: '',
          mode: 'hold',
          context: '',
        },
        camera_pan_backward: {
          action: 'camera_pan_backward',
          keys: ['KeyS', 'ArrowDown'],
          mouse: '',
          mode: 'hold',
          context: '',
        },
        camera_pan_left: {
          action: 'camera_pan_left',
          keys: ['KeyA', 'ArrowLeft'],
          mouse: '',
          mode: 'hold',
          context: '',
        },
        camera_pan_right: {
          action: 'camera_pan_right',
          keys: ['KeyD', 'ArrowRight'],
          mouse: '',
          mode: 'hold',
          context: '',
        },
        camera_zoom: {
          action: 'camera_zoom',
          keys: [],
          mouse: 'wheel',
          mode: 'hold',
          context: '',
        },
        camera_recenter: {
          action: 'camera_recenter',
          keys: ['Space'],
          mouse: 'double_click_ground',
          mode: 'press',
          context: '',
        },
        select_part: {
          action: 'select_part',
          keys: [],
          mouse: 'left_click',
          mode: 'press',
          context: '',
        },
        grow_mode_toggle: {
          action: 'grow_mode_toggle',
          keys: ['KeyG'],
          mouse: '',
          mode: 'toggle',
          context: '',
        },
        root_sight_toggle: {
          action: 'root_sight_toggle',
          keys: ['KeyR'],
          mouse: '',
          mode: 'toggle',
          context: '',
        },
        emote_wheel: {
          action: 'emote_wheel',
          keys: ['KeyE'],
          mouse: '',
          mode: 'press',
          context: '',
        },
        inventory_overview_toggle: {
          action: 'inventory_overview_toggle',
          keys: ['KeyI'],
          mouse: '',
          mode: 'toggle',
          context: '',
        },
        inventory_slot_1: {
          action: 'inventory_slot_1',
          keys: ['Digit1'],
          mouse: '',
          mode: 'press',
          context: '',
        },
        inventory_slot_2: {
          action: 'inventory_slot_2',
          keys: ['Digit2'],
          mouse: '',
          mode: 'press',
          context: '',
        },
        inventory_slot_3: {
          action: 'inventory_slot_3',
          keys: ['Digit3'],
          mouse: '',
          mode: 'press',
          context: '',
        },
        inventory_slot_4: {
          action: 'inventory_slot_4',
          keys: ['Digit4'],
          mouse: '',
          mode: 'press',
          context: '',
        },
        inventory_slot_5: {
          action: 'inventory_slot_5',
          keys: ['Digit5'],
          mouse: '',
          mode: 'press',
          context: '',
        },
        inventory_slot_6: {
          action: 'inventory_slot_6',
          keys: ['Digit6'],
          mouse: '',
          mode: 'press',
          context: '',
        },
        inventory_slot_7: {
          action: 'inventory_slot_7',
          keys: ['Digit7'],
          mouse: '',
          mode: 'press',
          context: '',
        },
        inventory_slot_8: {
          action: 'inventory_slot_8',
          keys: ['Digit8'],
          mouse: '',
          mode: 'press',
          context: '',
        },
        inventory_slot_9: {
          action: 'inventory_slot_9',
          keys: ['Digit9'],
          mouse: '',
          mode: 'press',
          context: '',
        },
        inventory_slot_10: {
          action: 'inventory_slot_10',
          keys: ['Digit0'],
          mouse: '',
          mode: 'press',
          context: '',
        },
        grow_cancel: {
          action: 'grow_cancel',
          keys: ['Escape'],
          mouse: 'right_click',
          mode: 'press',
          context: '',
        },
        dev_panel_toggle: {
          action: 'dev_panel_toggle',
          keys: ['Backquote'],
          mouse: '',
          mode: 'toggle',
          context: '',
        },
        debug_toggle: {
          action: 'debug_toggle',
          keys: ['ShiftLeft', 'ShiftRight'],
          mouse: '',
          mode: 'toggle',
          context: '',
        },
        hint_card_toggle: {
          action: 'hint_card_toggle',
          keys: ['KeyH'],
          mouse: '',
          mode: 'toggle',
          context: '',
        },
        plant_regenerate: {
          action: 'plant_regenerate',
          keys: ['KeyR'],
          mouse: '',
          mode: 'press',
          context: 'dev',
        },
      };
      return {
        status: 200,
        body: {
          bindings: defaultBindings,
          touch_min_target_px: 44,
          hud_max_screen_fraction: 0.2,
          root_sight_mode: 'toggle',
          text_scale: 1.0,
          context_dock_fade_ms: 150,
        },
      };
    }
  }

  if (
    url.pathname === '/config/chat' ||
    url.pathname === '/config/reports' ||
    url.pathname === '/config/network' ||
    url.pathname === '/config/terrain' ||
    url.pathname === '/config/physics' ||
    url.pathname === '/config/water' ||
    // T02: every root-sight tunable reaches the client. A hand-written
    // whitelist served seven of seventeen, so the cutaway radius, bubble
    // budget, burrow depth and rebuild rate silently ran on compiled-in
    // defaults while the file said otherwise.
    url.pathname === '/config/root_sight' ||
    // T04: the client paints mutations from the style table the config
    // validator owns, so appearance stays data (RULE_3).
    url.pathname === '/config/mutation_visuals' ||
    // C05: the shop's catalogue and its currency name. The client has fetched
    // `/config/shop` since the panel was written and no route ever answered it,
    // so the shop rendered "Nothing for sale yet" no matter what the file said.
    url.pathname === '/config/shop' ||
    // AL-01/ADR-027: the client reads the dev-only size class and the six
    // benchmark poses from the same file the dev panel edits.
    url.pathname === '/config/dev'
  ) {
    // T05: Serve chat/report tunables so client-side limits mirror server
    // enforcement; the network file also carries the client ping thresholds.
    const flat = await readFlatConfig(configDir, url.pathname.slice('/config/'.length));
    return { status: 200, body: flat ?? {} };
  }

  if (url.pathname === '/config/ui') {
    // C01: Serve UI config
    try {
      const values = await readConfigValues(configDir, 'ui');
      if (!values) throw new Error('ui.json unreadable');
      const uiConfig = {
        text_scale: values.text_scale?.value ?? 1.0,
        layers: values.layers?.value ?? {
          world: 0,
          hud: 100,
          panel: 200,
          menu: 300,
          modal: 400,
          toast: 500,
          tooltip: 600,
          debug: 700,
        },
        theme: values.theme?.value ?? {},
        toast_duration_ms: values.toast_duration_ms?.value ?? 4000,
        toast_max_stack: values.toast_max_stack?.value ?? 5,
        hint_card_duration_ms: values.hint_card_duration_ms?.value ?? 10000,
        hint_card_max_lines: values.hint_card_max_lines?.value ?? 3,
        panel_default_width_px: values.panel_default_width_px?.value ?? 320,
        panel_animation_ms: values.panel_animation_ms?.value ?? 200,
        reduced_motion: values.reduced_motion?.value ?? false,
        safe_area_padding_px: values.safe_area_padding_px?.value ?? 8,
      };

      // The route used to whitelist eleven of sixteen entries, so
      // `hud_update_interval_ms`, `damage_vignette_ms` and the three health
      // thresholds in the file never reached the client and it ran on
      // compiled-in defaults. Every entry rides along; the explicit fields
      // above still win because `layers` and `theme` are derived here.
      const flat: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(values)) {
        flat[key] = (entry as { value?: unknown }).value;
      }
      return { status: 200, body: { ...flat, ...uiConfig } };
    } catch {
      return {
        status: 200,
        body: {
          text_scale: 1.0,
          layers: {
            world: 0,
            hud: 100,
            panel: 200,
            menu: 300,
            modal: 400,
            toast: 500,
            tooltip: 600,
            debug: 700,
          },
          theme: {},
          toast_duration_ms: 4000,
          toast_max_stack: 5,
          hint_card_duration_ms: 10000,
          hint_card_max_lines: 3,
          panel_default_width_px: 320,
          panel_animation_ms: 200,
          reduced_motion: false,
          safe_area_padding_px: 8,
        },
      };
    }
  }

  return null;
}
