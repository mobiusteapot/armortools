
class MakePaint {

	static get isRaytracedBake(): bool {
		///if (krom_direct3d12 || krom_vulkan || krom_metal)
		return Context.raw.bakeType == BakeType.BakeInit;
		///else
		return false;
		///end
	}

	static run = (data: NodeShaderData, matcon: TMaterialContext): NodeShaderContext => {
		let context_id = "paint";

		let con_paint: NodeShaderContext = data.add_context({
			name: context_id,
			depth_write: false,
			compare_mode: "always", // TODO: align texcoords winding order
			// cull_mode: "counter_clockwise",
			cull_mode: "none",
			vertex_elements: [{name: "pos", data: "short4norm"}, {name: "nor", data: "short2norm"}, {name: "tex", data: "short2norm"}],
			color_attachments:
				Context.raw.tool == WorkspaceTool.ToolColorId ? ["RGBA32"] :
				(Context.raw.tool == WorkspaceTool.ToolPicker && Context.raw.pickPosNorTex) ? ["RGBA128", "RGBA128"] :
				(Context.raw.tool == WorkspaceTool.ToolPicker || Context.raw.tool == WorkspaceTool.ToolMaterial) ? ["RGBA32", "RGBA32", "RGBA32", "RGBA32"] :
				(Context.raw.tool == WorkspaceTool.ToolBake && MakePaint.isRaytracedBake) ? ["RGBA64", "RGBA64"] :
					["RGBA32", "RGBA32", "RGBA32", "R8"]
		});

		con_paint.data.color_writes_red = [true, true, true, true];
		con_paint.data.color_writes_green = [true, true, true, true];
		con_paint.data.color_writes_blue = [true, true, true, true];
		con_paint.data.color_writes_alpha = [true, true, true, true];
		con_paint.allow_vcols = Context.raw.paintObject.data.cols != null;

		let vert = con_paint.make_vert();
		let frag = con_paint.make_frag();
		frag.ins = vert.outs;

		///if (krom_direct3d12 || krom_vulkan || krom_metal)
		if (Context.raw.tool == WorkspaceTool.ToolBake && Context.raw.bakeType == BakeType.BakeInit) {
			// Init raytraced bake
			MakeBake.positionAndNormal(vert, frag);
			con_paint.data.shader_from_source = true;
			con_paint.data.vertex_shader = vert.get();
			con_paint.data.fragment_shader = frag.get();
			return con_paint;
		}
		///end

		if (Context.raw.tool == WorkspaceTool.ToolBake) {
			MakeBake.setColorWrites(con_paint);
		}

		if (Context.raw.tool == WorkspaceTool.ToolColorId || Context.raw.tool == WorkspaceTool.ToolPicker || Context.raw.tool == WorkspaceTool.ToolMaterial) {
			MakeColorIdPicker.run(vert, frag);
			con_paint.data.shader_from_source = true;
			con_paint.data.vertex_shader = vert.get();
			con_paint.data.fragment_shader = frag.get();
			return con_paint;
		}

		let faceFill = Context.raw.tool == WorkspaceTool.ToolFill && Context.raw.fillTypeHandle.position == FillType.FillFace;
		let uvIslandFill = Context.raw.tool == WorkspaceTool.ToolFill && Context.raw.fillTypeHandle.position == FillType.FillUVIsland;
		let decal = Context.raw.tool == WorkspaceTool.ToolDecal || Context.raw.tool == WorkspaceTool.ToolText;

		///if (krom_direct3d11 || krom_direct3d12 || krom_metal || krom_vulkan)
		vert.write('vec2 tpos = vec2(tex.x * 2.0 - 1.0, (1.0 - tex.y) * 2.0 - 1.0);');
		///else
		vert.write('vec2 tpos = vec2(tex.xy * 2.0 - 1.0);');
		///end

		vert.write('gl_Position = vec4(tpos, 0.0, 1.0);');

		let decalLayer = Context.raw.layer.fill_layer != null && Context.raw.layer.uvType == UVType.UVProject;
		if (decalLayer) {
			vert.add_uniform('mat4 WVP', '_decalLayerMatrix');
		}
		else {
			vert.add_uniform('mat4 WVP', '_worldViewProjectionMatrix');
		}

		vert.add_out('vec4 ndc');
		vert.write_attrib('ndc = mul(vec4(pos.xyz, 1.0), WVP);');

		frag.write_attrib('vec3 sp = vec3((ndc.xyz / ndc.w) * 0.5 + 0.5);');
		frag.write_attrib('sp.y = 1.0 - sp.y;');
		frag.write_attrib('sp.z -= 0.0001;'); // small bias

		let uvType = Context.raw.layer.fill_layer != null ? Context.raw.layer.uvType : Context.raw.brushPaint;
		if (uvType == UVType.UVProject) frag.ndcpos = true;

		frag.add_uniform('vec4 inp', '_inputBrush');
		frag.add_uniform('vec4 inplast', '_inputBrushLast');
		frag.add_uniform('float aspectRatio', '_aspectRatioWindowF');
		frag.write('vec2 bsp = sp.xy * 2.0 - 1.0;');
		frag.write('bsp.x *= aspectRatio;');
		frag.write('bsp = bsp * 0.5 + 0.5;');

		frag.add_uniform('sampler2D gbufferD');

		frag.add_out('vec4 fragColor[4]');

		frag.add_uniform('float brushRadius', '_brushRadius');
		frag.add_uniform('float brushOpacity', '_brushOpacity');
		frag.add_uniform('float brushHardness', '_brushHardness');

		if (Context.raw.tool == WorkspaceTool.ToolBrush  ||
			Context.raw.tool == WorkspaceTool.ToolEraser ||
			Context.raw.tool == WorkspaceTool.ToolClone  ||
			Context.raw.tool == WorkspaceTool.ToolBlur   ||
			Context.raw.tool == WorkspaceTool.ToolSmudge   ||
			Context.raw.tool == WorkspaceTool.ToolParticle ||
			decal) {

			let depthReject = !Context.raw.xray;
			if (Config.raw.brush_3d && !Config.raw.brush_depth_reject) depthReject = false;

			// TODO: sp.z needs to take height channel into account
			let particle = Context.raw.tool == WorkspaceTool.ToolParticle;
			if (Config.raw.brush_3d && !decal && !particle) {
				if (MakeMaterial.heightUsed || Context.raw.symX || Context.raw.symY || Context.raw.symZ) depthReject = false;
			}

			if (depthReject) {
				///if (krom_direct3d11 || krom_direct3d12 || krom_metal || krom_vulkan)
				frag.write('if (sp.z > textureLod(gbufferD, sp.xy, 0.0).r + 0.0005) discard;');
				///else
				frag.write('if (sp.z > textureLod(gbufferD, vec2(sp.x, 1.0 - sp.y), 0.0).r + 0.0005) discard;');
				///end
			}

			MakeBrush.run(vert, frag);
		}
		else { // Fill, Bake
			frag.write('float dist = 0.0;');
			let angleFill = Context.raw.tool == WorkspaceTool.ToolFill && Context.raw.fillTypeHandle.position == FillType.FillAngle;
			if (angleFill) {
				frag.add_function(ShaderFunctions.str_octahedronWrap);
				frag.add_uniform('sampler2D gbuffer0');
				frag.write('vec2 g0 = textureLod(gbuffer0, inp.xy, 0.0).rg;');
				frag.write('vec3 wn;');
				frag.write('wn.z = 1.0 - abs(g0.x) - abs(g0.y);');
				frag.write('wn.xy = wn.z >= 0.0 ? g0.xy : octahedronWrap(g0.xy);');
				frag.write('wn = normalize(wn);');
				frag.n = true;
				let angle = Context.raw.brushAngleRejectDot;
				frag.write(`if (dot(wn, n) < ${angle}) discard;`);
			}
			let stencilFill = Context.raw.tool == WorkspaceTool.ToolFill && Context.raw.brushStencilImage != null;
			if (stencilFill) {
				///if (krom_direct3d11 || krom_direct3d12 || krom_metal || krom_vulkan)
				frag.write('if (sp.z > textureLod(gbufferD, sp.xy, 0.0).r + 0.0005) discard;');
				///else
				frag.write('if (sp.z > textureLod(gbufferD, vec2(sp.x, 1.0 - sp.y), 0.0).r + 0.0005) discard;');
				///end
			}
		}

		if (Context.raw.colorIdPicked || faceFill || uvIslandFill) {
			vert.add_out('vec2 texCoordPick');
			vert.write('texCoordPick = tex;');
			if (Context.raw.colorIdPicked) {
				MakeDiscard.colorId(vert, frag);
			}
			if (faceFill) {
				MakeDiscard.face(vert, frag);
			}
			else if (uvIslandFill) {
				MakeDiscard.uvIsland(vert, frag);
			}
		}

		if (Context.raw.pickerMaskHandle.position == PickerMask.MaskMaterial) {
			MakeDiscard.materialId(vert, frag);
		}

		MakeTexcoord.run(vert, frag);

		if (Context.raw.tool == WorkspaceTool.ToolClone || Context.raw.tool == WorkspaceTool.ToolBlur || Context.raw.tool == WorkspaceTool.ToolSmudge) {
			frag.add_uniform('sampler2D gbuffer2');
			frag.add_uniform('vec2 gbufferSize', '_gbufferSize');
			frag.add_uniform('sampler2D texpaint_undo', '_texpaint_undo');
			frag.add_uniform('sampler2D texpaint_nor_undo', '_texpaint_nor_undo');
			frag.add_uniform('sampler2D texpaint_pack_undo', '_texpaint_pack_undo');

			if (Context.raw.tool == WorkspaceTool.ToolClone) {
				MakeClone.run(vert, frag);
			}
			else { // Blur, Smudge
				MakeBlur.run(vert, frag);
			}
		}
		else {
			ParserMaterial.parse_emission = Context.raw.material.paintEmis;
			ParserMaterial.parse_subsurface = Context.raw.material.paintSubs;
			ParserMaterial.parse_height = Context.raw.material.paintHeight;
			ParserMaterial.parse_height_as_channel = true;
			let uvType = Context.raw.layer.fill_layer != null ? Context.raw.layer.uvType : Context.raw.brushPaint;
			ParserMaterial.triplanar = uvType == UVType.UVTriplanar && !decal;
			ParserMaterial.sample_keep_aspect = decal;
			ParserMaterial.sample_uv_scale = 'brushScale';
			let sout = ParserMaterial.parse(UINodes.getCanvasMaterial(), con_paint, vert, frag, matcon);
			ParserMaterial.parse_emission = false;
			ParserMaterial.parse_subsurface = false;
			ParserMaterial.parse_height_as_channel = false;
			ParserMaterial.parse_height = false;
			let base = sout.out_basecol;
			let rough = sout.out_roughness;
			let met = sout.out_metallic;
			let occ = sout.out_occlusion;
			let nortan = ParserMaterial.out_normaltan;
			let height = sout.out_height;
			let opac = sout.out_opacity;
			let emis = sout.out_emission;
			let subs = sout.out_subsurface;
			frag.write(`vec3 basecol = ${base};`);
			frag.write(`float roughness = ${rough};`);
			frag.write(`float metallic = ${met};`);
			frag.write(`float occlusion = ${occ};`);
			frag.write(`vec3 nortan = ${nortan};`);
			frag.write(`float height = ${height};`);
			frag.write(`float mat_opacity = ${opac};`);
			frag.write('float opacity = mat_opacity;');
			if (Context.raw.layer.fill_layer == null) {
				frag.write('opacity *= brushOpacity;');
			}
			if (Context.raw.material.paintEmis) {
				frag.write(`float emis = ${emis};`);
			}
			if (Context.raw.material.paintSubs) {
				frag.write(`float subs = ${subs};`);
			}
			if (parseFloat(height) != 0.0 && !MakeMaterial.heightUsed) {
				MakeMaterial.heightUsed = true;
				// Height used for the first time, also rebuild vertex shader
				return MakePaint.run(data, matcon);
			}
			if (parseFloat(emis) != 0.0) MakeMaterial.emisUsed = true;
			if (parseFloat(subs) != 0.0) MakeMaterial.subsUsed = true;
		}

		if (Context.raw.brushMaskImage != null && Context.raw.tool == WorkspaceTool.ToolDecal) {
			frag.add_uniform('sampler2D texbrushmask', '_texbrushmask');
			frag.write('vec4 mask_sample = textureLod(texbrushmask, uvsp, 0.0);');
			if (Context.raw.brushMaskImageIsAlpha) {
				frag.write('opacity *= mask_sample.a;');
			}
			else {
				frag.write('opacity *= mask_sample.r * mask_sample.a;');
			}
		}
		else if (Context.raw.tool == WorkspaceTool.ToolText) {
			frag.add_uniform('sampler2D textexttool', '_textexttool');
			frag.write('opacity *= textureLod(textexttool, uvsp, 0.0).r;');
		}

		if (Context.raw.brushStencilImage != null && (
			Context.raw.tool == WorkspaceTool.ToolBrush  ||
			Context.raw.tool == WorkspaceTool.ToolEraser ||
			Context.raw.tool == WorkspaceTool.ToolFill ||
			Context.raw.tool == WorkspaceTool.ToolClone  ||
			Context.raw.tool == WorkspaceTool.ToolBlur   ||
			Context.raw.tool == WorkspaceTool.ToolSmudge   ||
			Context.raw.tool == WorkspaceTool.ToolParticle ||
			decal)) {
			frag.add_uniform('sampler2D texbrushstencil', '_texbrushstencil');
			frag.add_uniform('vec4 stencilTransform', '_stencilTransform');
			frag.write('vec2 stencil_uv = vec2((sp.xy - stencilTransform.xy) / stencilTransform.z * vec2(aspectRatio, 1.0));');
			frag.write('vec2 stencil_size = vec2(textureSize(texbrushstencil, 0));');
			frag.write('float stencil_ratio = stencil_size.y / stencil_size.x;');
			frag.write('stencil_uv -= vec2(0.5 / stencil_ratio, 0.5);');
			frag.write(`stencil_uv = vec2(stencil_uv.x * cos(stencilTransform.w) - stencil_uv.y * sin(stencilTransform.w),
										  stencil_uv.x * sin(stencilTransform.w) + stencil_uv.y * cos(stencilTransform.w));`);
			frag.write('stencil_uv += vec2(0.5 / stencil_ratio, 0.5);');
			frag.write('stencil_uv.x *= stencil_ratio;');
			frag.write('if (stencil_uv.x < 0 || stencil_uv.x > 1 || stencil_uv.y < 0 || stencil_uv.y > 1) discard;');
			frag.write('vec4 texbrushstencil_sample = textureLod(texbrushstencil, stencil_uv, 0.0);');
			if (Context.raw.brushStencilImageIsAlpha) {
				frag.write('opacity *= texbrushstencil_sample.a;');
			}
			else {
				frag.write('opacity *= texbrushstencil_sample.r * texbrushstencil_sample.a;');
			}
		}

		if (Context.raw.brushMaskImage != null && (Context.raw.tool == WorkspaceTool.ToolBrush || Context.raw.tool == WorkspaceTool.ToolEraser)) {
			frag.add_uniform('sampler2D texbrushmask', '_texbrushmask');
			frag.write('vec2 binp_mask = inp.xy * 2.0 - 1.0;');
			frag.write('binp_mask.x *= aspectRatio;');
			frag.write('binp_mask = binp_mask * 0.5 + 0.5;');
			frag.write('vec2 pa_mask = bsp.xy - binp_mask.xy;');
			if (Context.raw.brushDirectional) {
				frag.add_uniform('vec3 brushDirection', '_brushDirection');
				frag.write('if (brushDirection.z == 0.0) discard;');
				frag.write('pa_mask = vec2(pa_mask.x * brushDirection.x - pa_mask.y * brushDirection.y, pa_mask.x * brushDirection.y + pa_mask.y * brushDirection.x);');
			}
			let angle = Context.raw.brushAngle + Context.raw.brushNodesAngle;
			if (angle != 0.0) {
				frag.add_uniform('vec2 brushAngle', '_brushAngle');
				frag.write('pa_mask.xy = vec2(pa_mask.x * brushAngle.x - pa_mask.y * brushAngle.y, pa_mask.x * brushAngle.y + pa_mask.y * brushAngle.x);');
			}
			frag.write('pa_mask /= brushRadius;');
			if (Config.raw.brush_3d) {
				frag.add_uniform('vec3 eye', '_cameraPosition');
				frag.write('pa_mask *= distance(eye, winp.xyz) / 1.5;');
			}
			frag.write('pa_mask = pa_mask.xy * 0.5 + 0.5;');
			frag.write('vec4 mask_sample = textureLod(texbrushmask, pa_mask, 0.0);');
			if (Context.raw.brushMaskImageIsAlpha) {
				frag.write('opacity *= mask_sample.a;');
			}
			else {
				frag.write('opacity *= mask_sample.r * mask_sample.a;');
			}
		}

		frag.write('if (opacity == 0.0) discard;');

		if (Context.raw.tool == WorkspaceTool.ToolParticle) { // Particle mask
			MakeParticle.mask(vert, frag);
		}
		else { // Brush cursor mask
			frag.write('float str = clamp((brushRadius - dist) * brushHardness * 400.0, 0.0, 1.0) * opacity;');
		}

		// Manual blending to preserve memory
		frag.wvpposition = true;
		frag.write('vec2 sample_tc = vec2(wvpposition.xy / wvpposition.w) * 0.5 + 0.5;');
		///if (krom_direct3d11 || krom_direct3d12 || krom_metal || krom_vulkan)
		frag.write('sample_tc.y = 1.0 - sample_tc.y;');
		///end
		frag.add_uniform('sampler2D paintmask');
		frag.write('float sample_mask = textureLod(paintmask, sample_tc, 0.0).r;');
		frag.write('str = max(str, sample_mask);');
		// frag.write('str = clamp(str + sample_mask, 0.0, 1.0);');

		frag.add_uniform('sampler2D texpaint_undo', '_texpaint_undo');
		frag.write('vec4 sample_undo = textureLod(texpaint_undo, sample_tc, 0.0);');

		let matid = Context.raw.material.id / 255;
		if (Context.raw.pickerMaskHandle.position == PickerMask.MaskMaterial) {
			matid = Context.raw.materialIdPicked / 255; // Keep existing material id in place when mask is set
		}
		let matidString = ParserMaterial.vec1(matid * 3.0);
		frag.write(`float matid = ${matidString};`);

		// matid % 3 == 0 - normal, 1 - emission, 2 - subsurface
		if (Context.raw.material.paintEmis) {
			frag.write('if (emis > 0.0) {');
			frag.write('	matid += 1.0 / 255.0;');
			frag.write('	if (str == 0.0) discard;');
			frag.write('}');
		}
		else if (Context.raw.material.paintSubs) {
			frag.write('if (subs > 0.0) {');
			frag.write('    matid += 2.0 / 255.0;');
			frag.write('	if (str == 0.0) discard;');
			frag.write('}');
		}

		let isMask = Context.raw.layer.isMask();
		let layered = Context.raw.layer != Project.layers[0];
		if (layered && !isMask) {
			if (Context.raw.tool == WorkspaceTool.ToolEraser) {
				frag.write('fragColor[0] = vec4(mix(sample_undo.rgb, vec3(0.0, 0.0, 0.0), str), sample_undo.a - str);');
				frag.write('nortan = vec3(0.5, 0.5, 1.0);');
				frag.write('occlusion = 1.0;');
				frag.write('roughness = 0.0;');
				frag.write('metallic = 0.0;');
				frag.write('matid = 0.0;');
			}
			else if (Context.raw.tool == WorkspaceTool.ToolParticle || decal || Context.raw.brushMaskImage != null) {
				frag.write('fragColor[0] = vec4(' + MakeMaterial.blendMode(frag, Context.raw.brushBlending, 'sample_undo.rgb', 'basecol', 'str') + ', max(str, sample_undo.a));');
			}
			else {
				if (Context.raw.layer.fill_layer != null) {
					frag.write('fragColor[0] = vec4(' + MakeMaterial.blendMode(frag, Context.raw.brushBlending, 'sample_undo.rgb', 'basecol', 'opacity') + ', mat_opacity);');
				}
				else {
					frag.write('fragColor[0] = vec4(' + MakeMaterial.blendMode(frag, Context.raw.brushBlending, 'sample_undo.rgb', 'basecol', 'opacity') + ', max(str, sample_undo.a));');
				}
			}
			frag.write('fragColor[1] = vec4(nortan, matid);');

			let height = "0.0";
			if (Context.raw.material.paintHeight && MakeMaterial.heightUsed) {
				height = "height";
			}

			if (decal) {
				frag.add_uniform('sampler2D texpaint_pack_undo', '_texpaint_pack_undo');
				frag.write('vec4 sample_pack_undo = textureLod(texpaint_pack_undo, sample_tc, 0.0);');
				frag.write(`fragColor[2] = mix(sample_pack_undo, vec4(occlusion, roughness, metallic, ${height}), str);`);
			}
			else {
				frag.write(`fragColor[2] = vec4(occlusion, roughness, metallic, ${height});`);
			}
		}
		else {
			if (Context.raw.tool == WorkspaceTool.ToolEraser) {
				frag.write('fragColor[0] = vec4(mix(sample_undo.rgb, vec3(0.0, 0.0, 0.0), str), sample_undo.a - str);');
				frag.write('fragColor[1] = vec4(0.5, 0.5, 1.0, 0.0);');
				frag.write('fragColor[2] = vec4(1.0, 0.0, 0.0, 0.0);');
			}
			else {
				frag.add_uniform('sampler2D texpaint_nor_undo', '_texpaint_nor_undo');
				frag.add_uniform('sampler2D texpaint_pack_undo', '_texpaint_pack_undo');
				frag.write('vec4 sample_nor_undo = textureLod(texpaint_nor_undo, sample_tc, 0.0);');
				frag.write('vec4 sample_pack_undo = textureLod(texpaint_pack_undo, sample_tc, 0.0);');
				frag.write('fragColor[0] = vec4(' + MakeMaterial.blendMode(frag, Context.raw.brushBlending, 'sample_undo.rgb', 'basecol', 'str') + ', max(str, sample_undo.a));');
				frag.write('fragColor[1] = vec4(mix(sample_nor_undo.rgb, nortan, str), matid);');
				if (Context.raw.material.paintHeight && MakeMaterial.heightUsed) {
					frag.write('fragColor[2] = mix(sample_pack_undo, vec4(occlusion, roughness, metallic, height), str);');
				}
				else {
					frag.write('fragColor[2] = vec4(mix(sample_pack_undo.rgb, vec3(occlusion, roughness, metallic), str), 0.0);');
				}
			}
		}
		frag.write('fragColor[3] = vec4(str, 0.0, 0.0, 1.0);');

		if (!Context.raw.material.paintBase) {
			con_paint.data.color_writes_red[0] = false;
			con_paint.data.color_writes_green[0] = false;
			con_paint.data.color_writes_blue[0] = false;
		}
		if (!Context.raw.material.paintOpac) {
			con_paint.data.color_writes_alpha[0] = false;
		}
		if (!Context.raw.material.paintNor) {
			con_paint.data.color_writes_red[1] = false;
			con_paint.data.color_writes_green[1] = false;
			con_paint.data.color_writes_blue[1] = false;
		}
		if (!Context.raw.material.paintOcc) {
			con_paint.data.color_writes_red[2] = false;
		}
		if (!Context.raw.material.paintRough) {
			con_paint.data.color_writes_green[2] = false;
		}
		if (!Context.raw.material.paintMet) {
			con_paint.data.color_writes_blue[2] = false;
		}
		if (!Context.raw.material.paintHeight) {
			con_paint.data.color_writes_alpha[2] = false;
		}

		// Base color only as mask
		if (isMask) {
			// TODO: Apply opacity into base
			// frag.write('fragColor[0].rgb *= fragColor[0].a;');
			con_paint.data.color_writes_green[0] = false;
			con_paint.data.color_writes_blue[0] = false;
			con_paint.data.color_writes_alpha[0] = false;
			con_paint.data.color_writes_red[1] = false;
			con_paint.data.color_writes_green[1] = false;
			con_paint.data.color_writes_blue[1] = false;
			con_paint.data.color_writes_alpha[1] = false;
			con_paint.data.color_writes_red[2] = false;
			con_paint.data.color_writes_green[2] = false;
			con_paint.data.color_writes_blue[2] = false;
			con_paint.data.color_writes_alpha[2] = false;
		}

		if (Context.raw.tool == WorkspaceTool.ToolBake) {
			MakeBake.run(con_paint, vert, frag);
		}

		ParserMaterial.finalize(con_paint);
		ParserMaterial.triplanar = false;
		ParserMaterial.sample_keep_aspect = false;
		con_paint.data.shader_from_source = true;
		con_paint.data.vertex_shader = vert.get();
		con_paint.data.fragment_shader = frag.get();

		return con_paint;
	}
}
