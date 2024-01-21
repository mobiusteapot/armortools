
class MakeMaterial {

	static defaultScon: ShaderContext = null;
	static defaultMcon: MaterialContext = null;

	static heightUsed = false;
	static emisUsed = false;
	static subsUsed = false;

	static getMOut = (): bool => {
		for (let n of UINodes.getCanvasMaterial().nodes) if (n.type == "OUTPUT_MATERIAL_PBR") return true;
		return false;
	}

	static parseMeshMaterial = () => {
		let m = Project.materials[0].data;

		for (let c of m.shader.contexts) {
			if (c.raw.name == "mesh") {
				array_remove(m.shader.raw.contexts, c.raw);
				array_remove(m.shader.contexts, c);
				MakeMaterial.deleteContext(c);
				break;
			}
		}

		if (MakeMesh.layerPassCount > 1) {
			let i = 0;
			while (i < m.shader.contexts.length) {
				let c = m.shader.contexts[i];
				for (let j = 1; j < MakeMesh.layerPassCount; ++j) {
					if (c.raw.name == "mesh" + j) {
						array_remove(m.shader.raw.contexts, c.raw);
						array_remove(m.shader.contexts, c);
						MakeMaterial.deleteContext(c);
						i--;
						break;
					}
				}
				i++;
			}

			i = 0;
			while (i < m.contexts.length) {
				let c = m.contexts[i];
				for (let j = 1; j < MakeMesh.layerPassCount; ++j) {
					if (c.raw.name == "mesh" + j) {
						array_remove(m.raw.contexts, c.raw);
						array_remove(m.contexts, c);
						i--;
						break;
					}
				}
				i++;
			}
		}

		let con = MakeMesh.run(new NodeShaderData({ name: "Material", canvas: null }));
		let scon = new ShaderContext(con.data, (scon: ShaderContext) => {});
		scon.overrideContext = {};
		if (con.frag.sharedSamplers.length > 0) {
			let sampler = con.frag.sharedSamplers[0];
			scon.overrideContext.shared_sampler = sampler.substr(sampler.lastIndexOf(" ") + 1);
		}
		if (!Context.raw.textureFilter) {
			scon.overrideContext.filter = "point";
		}
		m.shader.raw.contexts.push(scon.raw);
		m.shader.contexts.push(scon);

		for (let i = 1; i < MakeMesh.layerPassCount; ++i) {
			let con = MakeMesh.run(new NodeShaderData({ name: "Material", canvas: null }), i);
			let scon = new ShaderContext(con.data, (scon: ShaderContext) => {});
			scon.overrideContext = {};
			if (con.frag.sharedSamplers.length > 0) {
				let sampler = con.frag.sharedSamplers[0];
				scon.overrideContext.shared_sampler = sampler.substr(sampler.lastIndexOf(" ") + 1);
			}
			if (!Context.raw.textureFilter) {
				scon.overrideContext.filter = "point";
			}
			m.shader.raw.contexts.push(scon.raw);
			m.shader.contexts.push(scon);

			let mcon = new MaterialContext({ name: "mesh" + i, bind_textures: [] }, (self: MaterialContext) => {});
			m.raw.contexts.push(mcon.raw);
			m.contexts.push(mcon);
		}

		Context.raw.ddirty = 2;

		///if arm_voxels
		MakeMaterial.makeVoxel(m);
		///end

		///if (krom_direct3d12 || krom_vulkan || krom_metal)
		RenderPathRaytrace.dirty = 1;
		///end
	}

	static parseParticleMaterial = () => {
		let m = Context.raw.particleMaterial;
		let sc: ShaderContext = null;
		for (let c of m.shader.contexts) {
			if (c.raw.name == "mesh") {
				sc = c;
				break;
			}
		}
		if (sc != null) {
			array_remove(m.shader.raw.contexts, sc.raw);
			array_remove(m.shader.contexts, sc);
		}
		let con = MakeParticle.run(new NodeShaderData({ name: "MaterialParticle", canvas: null }));
		if (sc != null) MakeMaterial.deleteContext(sc);
		sc = new ShaderContext(con.data, (sc: ShaderContext) => {});
		m.shader.raw.contexts.push(sc.raw);
		m.shader.contexts.push(sc);
	}

	static parseMeshPreviewMaterial = (md: MaterialData = null) => {
		if (!MakeMaterial.getMOut()) return;

		let m = md == null ? Project.materials[0].data : md;
		let scon: ShaderContext = null;
		for (let c of m.shader.contexts) {
			if (c.raw.name == "mesh") {
				scon = c;
				break;
			}
		}
		array_remove(m.shader.raw.contexts, scon.raw);
		array_remove(m.shader.contexts, scon);

		let mcon: TMaterialContext = { name: "mesh", bind_textures: [] };

		let sd = new NodeShaderData({ name: "Material", canvas: null });
		let con = MakeMeshPreview.run(sd, mcon);

		for (let i = 0; i < m.contexts.length; ++i) {
			if (m.contexts[i].raw.name == "mesh") {
				m.contexts[i] = new MaterialContext(mcon, (self: MaterialContext) => {});
				break;
			}
		}

		if (scon != null) MakeMaterial.deleteContext(scon);

		let compileError = false;
		scon = new ShaderContext(con.data, (scon: ShaderContext) => {
			if (scon == null) compileError = true;
		});
		if (compileError) return;

		m.shader.raw.contexts.push(scon.raw);
		m.shader.contexts.push(scon);
	}

	///if arm_voxels
	static makeVoxel = (m: MaterialData) => {
		let rebuild = MakeMaterial.heightUsed;
		if (Config.raw.rp_gi != false && rebuild) {
			let scon: ShaderContext = null;
			for (let c of m.shader.contexts) {
				if (c.raw.name == "voxel") {
					scon = c;
					break;
				}
			}
			if (scon != null) MakeVoxel.run(scon);
		}
	}
	///end

	static parsePaintMaterial = (bakePreviews = true) => {
		if (!MakeMaterial.getMOut()) return;

		if (bakePreviews) {
			let current = Graphics2.current;
			if (current != null) current.end();
			MakeMaterial.bakeNodePreviews();
			if (current != null) current.begin(false);
		}

		let m = Project.materials[0].data;
		// let scon: ShaderContext = null;
		// let mcon: MaterialContext = null;
		for (let c of m.shader.contexts) {
			if (c.raw.name == "paint") {
				array_remove(m.shader.raw.contexts, c.raw);
				array_remove(m.shader.contexts, c);
				if (c != MakeMaterial.defaultScon) MakeMaterial.deleteContext(c);
				break;
			}
		}
		for (let c of m.contexts) {
			if (c.raw.name == "paint") {
				array_remove(m.raw.contexts, c.raw);
				array_remove(m.contexts, c);
				break;
			}
		}

		let sdata = new NodeShaderData({ name: "Material", canvas: UINodes.getCanvasMaterial() });
		let tmcon: TMaterialContext = { name: "paint", bind_textures: [] };
		let con = MakePaint.run(sdata, tmcon);

		let compileError = false;
		let scon = new ShaderContext(con.data, (scon: ShaderContext) => {
			if (scon == null) compileError = true;
		});
		if (compileError) return;
		scon.overrideContext = {};
		scon.overrideContext.addressing = "repeat";
		let mcon = new MaterialContext(tmcon, (mcon: MaterialContext) => {});

		m.shader.raw.contexts.push(scon.raw);
		m.shader.contexts.push(scon);
		m.raw.contexts.push(mcon.raw);
		m.contexts.push(mcon);

		if (MakeMaterial.defaultScon == null) MakeMaterial.defaultScon = scon;
		if (MakeMaterial.defaultMcon == null) MakeMaterial.defaultMcon = mcon;
	}

	static bakeNodePreviews = () => {
		Context.raw.nodePreviewsUsed = [];
		if (Context.raw.nodePreviews == null) Context.raw.nodePreviews = new Map();
		MakeMaterial.traverseNodes(UINodes.getCanvasMaterial().nodes, null, []);
		for (let key of Context.raw.nodePreviews.keys()) {
			if (Context.raw.nodePreviewsUsed.indexOf(key) == -1) {
				let image = Context.raw.nodePreviews.get(key);
				Base.notifyOnNextFrame(image.unload);
				Context.raw.nodePreviews.delete(key);
			}
		}
	}

	static traverseNodes = (nodes: TNode[], group: TNodeCanvas, parents: TNode[]) => {
		for (let node of nodes) {
			MakeMaterial.bakeNodePreview(node, group, parents);
			if (node.type == "GROUP") {
				for (let g of Project.materialGroups) {
					if (g.canvas.name == node.name) {
						parents.push(node);
						MakeMaterial.traverseNodes(g.canvas.nodes, g.canvas, parents);
						parents.pop();
						break;
					}
				}
			}
		}
	}

	static bakeNodePreview = (node: TNode, group: TNodeCanvas, parents: TNode[]) => {
		if (node.type == "BLUR") {
			let id = ParserMaterial.node_name(node, parents);
			let image = Context.raw.nodePreviews.get(id);
			Context.raw.nodePreviewsUsed.push(id);
			let resX = Math.floor(Config.getTextureResX() / 4);
			let resY = Math.floor(Config.getTextureResY() / 4);
			if (image == null || image.width != resX || image.height != resY) {
				if (image != null) image.unload();
				image = Image.createRenderTarget(resX, resY);
				Context.raw.nodePreviews.set(id, image);
			}

			ParserMaterial.blur_passthrough = true;
			UtilRender.makeNodePreview(UINodes.getCanvasMaterial(), node, image, group, parents);
			ParserMaterial.blur_passthrough = false;
		}
		else if (node.type == "DIRECT_WARP") {
			let id = ParserMaterial.node_name(node, parents);
			let image = Context.raw.nodePreviews.get(id);
			Context.raw.nodePreviewsUsed.push(id);
			let resX = Math.floor(Config.getTextureResX());
			let resY = Math.floor(Config.getTextureResY());
			if (image == null || image.width != resX || image.height != resY) {
				if (image != null) image.unload();
				image = Image.createRenderTarget(resX, resY);
				Context.raw.nodePreviews.set(id, image);
			}

			ParserMaterial.warp_passthrough = true;
			UtilRender.makeNodePreview(UINodes.getCanvasMaterial(), node, image, group, parents);
			ParserMaterial.warp_passthrough = false;
		}
		else if (node.type == "BAKE_CURVATURE") {
			let id = ParserMaterial.node_name(node, parents);
			let image = Context.raw.nodePreviews.get(id);
			Context.raw.nodePreviewsUsed.push(id);
			let resX = Math.floor(Config.getTextureResX());
			let resY = Math.floor(Config.getTextureResY());
			if (image == null || image.width != resX || image.height != resY) {
				if (image != null) image.unload();
				image = Image.createRenderTarget(resX, resY, TextureFormat.R8);
				Context.raw.nodePreviews.set(id, image);
			}

			if (RenderPathPaint.liveLayer == null) {
				RenderPathPaint.liveLayer = new SlotLayer("_live");
			}

			let _space = UIHeader.worktab.position;
			let _tool = Context.raw.tool;
			let _bakeType = Context.raw.bakeType;
			UIHeader.worktab.position = SpaceType.Space3D;
			Context.raw.tool = WorkspaceTool.ToolBake;
			Context.raw.bakeType = BakeType.BakeCurvature;

			ParserMaterial.bake_passthrough = true;
			ParserMaterial.start_node = node;
			ParserMaterial.start_group = group;
			ParserMaterial.start_parents = parents;
			MakeMaterial.parsePaintMaterial(false);
			ParserMaterial.bake_passthrough = false;
			ParserMaterial.start_node = null;
			ParserMaterial.start_group = null;
			ParserMaterial.start_parents = null;
			Context.raw.pdirty = 1;
			RenderPathPaint.useLiveLayer(true);
			RenderPathPaint.commandsPaint(false);
			RenderPathPaint.dilate(true, false);
			RenderPathPaint.useLiveLayer(false);
			Context.raw.pdirty = 0;

			UIHeader.worktab.position = _space;
			Context.raw.tool = _tool;
			Context.raw.bakeType = _bakeType;
			MakeMaterial.parsePaintMaterial(false);

			let rts = RenderPath.active.renderTargets;
			let texpaint_live = rts.get("texpaint_live");

			image.g2.begin(false);
			image.g2.drawImage(texpaint_live.image, 0, 0);
			image.g2.end();
		}
	}

	static parseNodePreviewMaterial = (node: TNode, group: TNodeCanvas = null, parents: TNode[] = null): { scon: ShaderContext, mcon: MaterialContext } => {
		if (node.outputs.length == 0) return null;
		let sdata = new NodeShaderData({ name: "Material", canvas: UINodes.getCanvasMaterial() });
		let mcon_raw: TMaterialContext = { name: "mesh", bind_textures: [] };
		let con = MakeNodePreview.run(sdata, mcon_raw, node, group, parents);
		let compileError = false;
		let scon = new ShaderContext(con.data, (scon: ShaderContext) => {
			if (scon == null) compileError = true;
		});
		if (compileError) return null;
		let mcon = new MaterialContext(mcon_raw, (mcon: MaterialContext) => {});
		return { scon: scon, mcon: mcon };
	}

	static parseBrush = () => {
		ParserLogic.parse(Context.raw.brush.canvas);
	}

	static blendMode = (frag: NodeShader, blending: i32, cola: string, colb: string, opac: string): string => {
		if (blending == BlendType.BlendMix) {
			return `mix(${cola}, ${colb}, ${opac})`;
		}
		else if (blending == BlendType.BlendDarken) {
			return `mix(${cola}, min(${cola}, ${colb}), ${opac})`;
		}
		else if (blending == BlendType.BlendMultiply) {
			return `mix(${cola}, ${cola} * ${colb}, ${opac})`;
		}
		else if (blending == BlendType.BlendBurn) {
			return `mix(${cola}, vec3(1.0, 1.0, 1.0) - (vec3(1.0, 1.0, 1.0) - ${cola}) / ${colb}, ${opac})`;
		}
		else if (blending == BlendType.BlendLighten) {
			return `max(${cola}, ${colb} * ${opac})`;
		}
		else if (blending == BlendType.BlendScreen) {
			return `(vec3(1.0, 1.0, 1.0) - (vec3(1.0 - ${opac}, 1.0 - ${opac}, 1.0 - ${opac}) + ${opac} * (vec3(1.0, 1.0, 1.0) - ${colb})) * (vec3(1.0, 1.0, 1.0) - ${cola}))`;
		}
		else if (blending == BlendType.BlendDodge) {
			return `mix(${cola}, ${cola} / (vec3(1.0, 1.0, 1.0) - ${colb}), ${opac})`;
		}
		else if (blending == BlendType.BlendAdd) {
			return `mix(${cola}, ${cola} + ${colb}, ${opac})`;
		}
		else if (blending == BlendType.BlendOverlay) {
			return `mix(${cola}, vec3(
				${cola}.r < 0.5 ? 2.0 * ${cola}.r * ${colb}.r : 1.0 - 2.0 * (1.0 - ${cola}.r) * (1.0 - ${colb}.r),
				${cola}.g < 0.5 ? 2.0 * ${cola}.g * ${colb}.g : 1.0 - 2.0 * (1.0 - ${cola}.g) * (1.0 - ${colb}.g),
				${cola}.b < 0.5 ? 2.0 * ${cola}.b * ${colb}.b : 1.0 - 2.0 * (1.0 - ${cola}.b) * (1.0 - ${colb}.b)
			), ${opac})`;
		}
		else if (blending == BlendType.BlendSoftLight) {
			return `((1.0 - ${opac}) * ${cola} + ${opac} * ((vec3(1.0, 1.0, 1.0) - ${cola}) * ${colb} * ${cola} + ${cola} * (vec3(1.0, 1.0, 1.0) - (vec3(1.0, 1.0, 1.0) - ${colb}) * (vec3(1.0, 1.0, 1.0) - ${cola}))))`;
		}
		else if (blending == BlendType.BlendLinearLight) {
			return `(${cola} + ${opac} * (vec3(2.0, 2.0, 2.0) * (${colb} - vec3(0.5, 0.5, 0.5))))`;
		}
		else if (blending == BlendType.BlendDifference) {
			return `mix(${cola}, abs(${cola} - ${colb}), ${opac})`;
		}
		else if (blending == BlendType.BlendSubtract) {
			return `mix(${cola}, ${cola} - ${colb}, ${opac})`;
		}
		else if (blending == BlendType.BlendDivide) {
			return `vec3(1.0 - ${opac}, 1.0 - ${opac}, 1.0 - ${opac}) * ${cola} + vec3(${opac}, ${opac}, ${opac}) * ${cola} / ${colb}`;
		}
		else if (blending == BlendType.BlendHue) {
			frag.add_function(ShaderFunctions.str_hue_sat);
			return `mix(${cola}, hsv_to_rgb(vec3(rgb_to_hsv(${colb}).r, rgb_to_hsv(${cola}).g, rgb_to_hsv(${cola}).b)), ${opac})`;
		}
		else if (blending == BlendType.BlendSaturation) {
			frag.add_function(ShaderFunctions.str_hue_sat);
			return `mix(${cola}, hsv_to_rgb(vec3(rgb_to_hsv(${cola}).r, rgb_to_hsv(${colb}).g, rgb_to_hsv(${cola}).b)), ${opac})`;
		}
		else if (blending == BlendType.BlendColor) {
			frag.add_function(ShaderFunctions.str_hue_sat);
			return `mix(${cola}, hsv_to_rgb(vec3(rgb_to_hsv(${colb}).r, rgb_to_hsv(${colb}).g, rgb_to_hsv(${cola}).b)), ${opac})`;
		}
		else { // BlendValue
			frag.add_function(ShaderFunctions.str_hue_sat);
			return `mix(${cola}, hsv_to_rgb(vec3(rgb_to_hsv(${cola}).r, rgb_to_hsv(${cola}).g, rgb_to_hsv(${colb}).b)), ${opac})`;
		}
	}

	static blendModeMask = (frag: NodeShader, blending: i32, cola: string, colb: string, opac: string): string => {
		if (blending == BlendType.BlendMix) {
			return `mix(${cola}, ${colb}, ${opac})`;
		}
		else if (blending == BlendType.BlendDarken) {
			return `mix(${cola}, min(${cola}, ${colb}), ${opac})`;
		}
		else if (blending == BlendType.BlendMultiply) {
			return `mix(${cola}, ${cola} * ${colb}, ${opac})`;
		}
		else if (blending == BlendType.BlendBurn) {
			return `mix(${cola}, 1.0 - (1.0 - ${cola}) / ${colb}, ${opac})`;
		}
		else if (blending == BlendType.BlendLighten) {
			return `max(${cola}, ${colb} * ${opac})`;
		}
		else if (blending == BlendType.BlendScreen) {
			return `(1.0 - ((1.0 - ${opac}) + ${opac} * (1.0 - ${colb})) * (1.0 - ${cola}))`;
		}
		else if (blending == BlendType.BlendDodge) {
			return `mix(${cola}, ${cola} / (1.0 - ${colb}), ${opac})`;
		}
		else if (blending == BlendType.BlendAdd) {
			return `mix(${cola}, ${cola} + ${colb}, ${opac})`;
		}
		else if (blending == BlendType.BlendOverlay) {
			return `mix(${cola}, ${cola} < 0.5 ? 2.0 * ${cola} * ${colb} : 1.0 - 2.0 * (1.0 - ${cola}) * (1.0 - ${colb}), ${opac})`;
		}
		else if (blending == BlendType.BlendSoftLight) {
			return `((1.0 - ${opac}) * ${cola} + ${opac} * ((1.0 - ${cola}) * ${colb} * ${cola} + ${cola} * (1.0 - (1.0 - ${colb}) * (1.0 - ${cola}))))`;
		}
		else if (blending == BlendType.BlendLinearLight) {
			return `(${cola} + ${opac} * (2.0 * (${colb} - 0.5)))`;
		}
		else if (blending == BlendType.BlendDifference) {
			return `mix(${cola}, abs(${cola} - ${colb}), ${opac})`;
		}
		else if (blending == BlendType.BlendSubtract) {
			return `mix(${cola}, ${cola} - ${colb}, ${opac})`;
		}
		else if (blending == BlendType.BlendDivide) {
			return `(1.0 - ${opac}) * ${cola} + ${opac} * ${cola} / ${colb}`;
		}
		else { // BlendHue, BlendSaturation, BlendColor, BlendValue
			return `mix(${cola}, ${colb}, ${opac})`;
		}
	}

	static getDisplaceStrength = (): f32 => {
		let sc = Context.mainObject().transform.scale.x;
		return Config.raw.displace_strength * 0.02 * sc;
	}

	static voxelgiHalfExtents = (): string => {
		let ext = Context.raw.vxaoExt;
		return `const vec3 voxelgiHalfExtents = vec3(${ext}, ${ext}, ${ext});`;
	}

	static deleteContext = (c: ShaderContext) => {
		Base.notifyOnNextFrame(() => { // Ensure pipeline is no longer in use
			c.delete();
		});
	}
}
