
let import_mesh_clear_layers: bool = true;

function import_mesh_run(path: string, _clear_layers = true, replace_existing = true) {
	if (!path_is_mesh(path)) {
		if (!context_enable_import_plugin(path)) {
			console_error(strings_error1());
			return;
		}
	}

	import_mesh_clear_layers = _clear_layers;
	context_raw.layer_filter = 0;

	let p = to_lower_case(path);
	if (ends_with(p, ".obj")) {
		import_obj_run(path, replace_existing);
	}
	else if (ends_with(p, ".blend")) {
		import_blend_mesh_run(path, replace_existing);
	}
	else {
		let ext = substring(path, string_last_index_of(path, ".") + 1, path.length);
		let importer = map_get(path_mesh_importers, ext);
		let mesh: any = importer(path);
		replace_existing ? import_mesh_make_mesh(mesh, path) : import_mesh_add_mesh(mesh);
	}

	project_mesh_assets = [path];

	///if (krom_android || krom_ios)
	sys_title_set(substring(path, string_last_index_of(path, path_sep) + 1, string_last_index_of(path, ".")));
	///end
}

function import_mesh_finish_import() {
	if (context_raw.merged_object != null) {
		mesh_object_remove(context_raw.merged_object);
		data_delete_mesh(context_raw.merged_object.data._.handle);
		context_raw.merged_object = null;
	}

	context_select_paint_object(context_main_object());

	if (project_paint_objects.length > 1) {
		// Sort by name
		array_sort(project_paint_objects, function (a: mesh_object_t, b: mesh_object_t): i32 {
			if (a.base.name < b.base.name) {
				return -1;
			}
			else if (a.base.name > b.base.name) {
				return 1;
			}
			return 0;
		});

		// No mask by default
		for (let i: i32 = 0; i < project_paint_objects.length; ++i) {
			let p = project_paint_objects[i];
			p.base.visible = true;
		}
		if (context_raw.merged_object == null) {
			util_mesh_merge();
		}
		context_raw.paint_object.skip_context = "paint";
		context_raw.merged_object.base.visible = true;
	}

	viewport_scale_to_bounds();

	if (context_raw.paint_object.base.name == "") {
		context_raw.paint_object.base.name = "Object";
	}
	make_material_parse_paint_material();
	make_material_parse_mesh_material();

	ui_view2d_hwnd.redraws = 2;

	///if arm_physics
	context_raw.paint_body = null;
	///end
}

function _import_mesh_make_mesh(mesh: any) {
	let raw = import_mesh_raw_mesh(mesh);
	if (mesh.cola != null) {
		array_push(raw.vertex_arrays, { values: mesh.cola, attrib: "col", data: "short4norm" });
	}

	let md: mesh_data_t = mesh_data_create(raw);
	context_raw.paint_object = context_main_object();

	context_select_paint_object(context_main_object());
	for (let i: i32 = 0; i < project_paint_objects.length; ++i) {
		let p = project_paint_objects[i];
		if (p == context_raw.paint_object) {
			continue;
		}
		data_delete_mesh(p.data._.handle);
		mesh_object_remove(p);
	}
	let handle = context_raw.paint_object.data._.handle;
	if (handle != "SceneSphere" && handle != "ScenePlane") {
		data_delete_mesh(handle);
	}

	if (import_mesh_clear_layers) {
		while (project_layers.length > 0) {
			let l = project_layers.pop();
			slot_layer_unload(l);
		}
		base_new_layer(false);
		app_notify_on_init(base_init_layers);
		history_reset();
	}

	mesh_object_set_data(context_raw.paint_object, md);
	context_raw.paint_object.base.name = mesh.name;
	project_paint_objects = [context_raw.paint_object];

	md._.handle = raw.name;
	map_set(data_cached_meshes, md._.handle, md);

	context_raw.ddirty = 4;
	ui_base_hwnds[tab_area_t.SIDEBAR0].redraws = 2;
	ui_base_hwnds[tab_area_t.SIDEBAR1].redraws = 2;

	// Wait for add_mesh calls to finish
	app_notify_on_init(import_mesh_finish_import);

	app_notify_on_next_frame(function (mesh: any) {
		let f32 = f32_array_create(config_get_texture_res_x() * config_get_texture_res_y() * 4);
		for (let i: i32 = 0; i < math_floor(mesh.inda.length); ++i) {
			let index = mesh.inda[i];
			f32[i * 4]     = mesh.posa[index * 4]     / 32767;
			f32[i * 4 + 1] = mesh.posa[index * 4 + 1] / 32767;
			f32[i * 4 + 2] = mesh.posa[index * 4 + 2] / 32767;
			f32[i * 4 + 3] = 1.0;
		}
		let imgmesh = image_from_bytes(f32.buffer, config_get_texture_res_x(), config_get_texture_res_y(), tex_format_t.RGBA128);
		let texpaint = project_layers[0].texpaint;
		g2_begin(texpaint);
		g2_set_pipeline(base_pipe_copy128);
		g2_draw_scaled_image(imgmesh, 0, 0, config_get_texture_res_x(), config_get_texture_res_y());
		g2_set_pipeline(null);
		g2_end();
	}, mesh);
}

function import_mesh_make_mesh(mesh: any, path: string) {
	if (mesh == null || mesh.posa == null || mesh.nora == null || mesh.inda == null || mesh.posa.length == 0) {
		console_error(strings_error3());
		return;
	}

	_import_mesh_make_mesh(mesh);
}

function import_mesh_add_mesh(mesh: any) {
	let raw = import_mesh_raw_mesh(mesh);
	if (mesh.cola != null) {
		array_push(raw.vertex_arrays, { values: mesh.cola, attrib: "col", data: "short4norm" });
	}

	let md: mesh_data_t = mesh_data_create(raw);

	let object = scene_add_mesh_object(md, context_raw.paint_object.materials, context_raw.paint_object.base);
	object.base.name = mesh.base.name;
	object.skip_context = "paint";

	// Ensure unique names
	for (let i: i32 = 0; i < project_paint_objects.length; ++i) {
		let p = project_paint_objects[i];
		if (p.base.name == object.base.name) {
			p.base.name += ".001";
			p.data._.handle += ".001";
			map_set(data_cached_meshes, p.data._.handle, p.data);
		}
	}

	array_push(project_paint_objects, object);

	md._.handle = raw.name;
	map_set(data_cached_meshes, md._.handle, md);

	context_raw.ddirty = 4;
	ui_base_hwnds[tab_area_t.SIDEBAR0].redraws = 2;
}

function import_mesh_raw_mesh(mesh: any): mesh_data_t {
	let posa: i16_array_t = i16_array_create(math_floor(mesh.inda.length * 4));
	for (let i: i32 = 0; i < posa.length; ++i) {
		posa[i] = 32767;
	}
	let inda: u32_array_t = u32_array_create(mesh.inda.length);
	for (let i: i32 = 0; i < inda.length; ++i) {
		inda[i] = i;
	}
	return {
		name: mesh.name,
		vertex_arrays: [
			{ values: posa, attrib: "pos", data: "short4norm" }
		],
		index_arrays: [
			{ values: inda, material: 0 }
		],
		scale_pos: 1.0
	};
}
