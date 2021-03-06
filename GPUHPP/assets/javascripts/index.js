/*
 * index.js
 * */

(function(global, THREE) {

    function FboPingPong(width, height, type) {
        this.readBufferIndex = 0;
        this.writeBufferIndex = 1;
        this.buffers = [
            this.createBuffer(width, height, type),
            this.createBuffer(width, height, type)
        ];
    }

    FboPingPong.prototype = {

        getReadBuffer : function() {
            return this.buffers[this.readBufferIndex];
        },

        getWriteBuffer : function() {
            return this.buffers[this.writeBufferIndex];
        },

        swap : function() {
            var tmp = this.buffers[this.writeBufferIndex];
            this.buffers[this.writeBufferIndex] = this.buffers[this.readBufferIndex];
            this.buffers[this.readBufferIndex] = tmp;
        },

        createBuffer : function(width, height, type) {
            return new THREE.WebGLRenderTarget(width, height, {
                wrapS: THREE.RepeatWrapping,
                wrapT: THREE.RepeatWrapping,
                minFilter: THREE.NearestFilter,
                magFilter: THREE.NearestFilter,
                format: THREE.RGBAFormat,
                type: type,
                stencilBuffer: false
            });
        }

    };

    var app, App = function(id) {
        app = this;
        app.init(id);
    };

    App.prototype = {

        init : function(id) {

            var $dom = $("#" + id);

            var scene = new THREE.Scene();
            var camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.001, 1000);
            camera.position.z = 10;

            var renderer = new THREE.WebGLRenderer({
                alpha: true,
                antialias: true
            });

            renderer.setClearColor(0x000000);
            renderer.setSize(window.innerWidth, window.innerHeight);
            $dom.append(renderer.domElement);

            var sceneRTT = new THREE.Scene();
            var cameraRTT = new THREE.OrthographicCamera( -1, 1, 1, -1, 0, 1 );
            var quadRTT = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), null);
            sceneRTT.add(quadRTT);

            var size = 256;

            // THREE.FloatType is not supported on iOS8.3
            var fboVelocityPP = new FboPingPong(size, size, THREE.HalfFloatType);

            var planeSize = 10;
            var plane = new THREE.Mesh(new THREE.PlaneBufferGeometry(planeSize, planeSize, size, size), new THREE.MeshBasicMaterial({ color: 0xffffff }));

            app.loadShader("plane.vert", function(vert) {
                app.loadShader("plane.frag", function(frag) {
                    plane.material = new THREE.ShaderMaterial({
                        uniforms : {
                            velocity : { type : "t", value : fboVelocityPP.getReadBuffer() }
                        },
                        vertexShader : vert,
                        fragmentShader : frag,
                        side : THREE.DoubleSide,
                        wireframe : true,
                        transparent : true
                    });
                });
            });

            scene.add(plane);

            var clock = new THREE.Clock();
            var trackballControls = new THREE.TrackballControls(camera);

            var init;
            var advect;

            var blit = function(material, writeBuffer) {
                quadRTT.material = material;
                renderer.render(sceneRTT, cameraRTT, writeBuffer, false);
            };

            var start = function(kernelV, initF, advectF) {

                var px = { type : "v2", value : new THREE.Vector2(1 / size, 1 / size) };

                init = new THREE.ShaderMaterial({
                    uniforms : {
                        px       : px
                    },
                    vertexShader : kernelV,
                    fragmentShader : initF
                });

                advect = new THREE.ShaderMaterial({
                    uniforms : {
                        velocity : { type : "t", value : fboVelocityPP.getReadBuffer() },
                        px       : px,
                        mouse    : { type : "v2", value : new THREE.Vector2(0.5, 0.5) },
                        radius   : { type : "f",  value  : 0.05 }
                    },
                    vertexShader : kernelV,
                    fragmentShader : advectF
                });

                var mouse = new THREE.Vector2(0, 0);
                var x0 = 0, y0 = 0;

                var updateMousePosition = function(e) {
                    mouse.x = (e.pageX / window.innerWidth) * 2 - 1;
                    mouse.y = - (e.pageY / window.innerHeight) * 2 + 1;
                };

                var raycaster = new THREE.Raycaster();

                document.addEventListener('mousemove', updateMousePosition);
                document.addEventListener('touchstart', updateMousePosition);
                document.addEventListener('touchmove', updateMousePosition);

                blit(init, fboVelocityPP.getWriteBuffer());
                fboVelocityPP.swap();

                (function loop() {
                    requestAnimationFrame(loop);

                    raycaster.setFromCamera(mouse, camera);

                    var intersect = raycaster.intersectObject(plane);
                    if(intersect.length > 0) {
                        // normalize to uv
                        var x = (intersect[0].point.x + planeSize * 0.5) / planeSize;
                        var y = (intersect[0].point.y + planeSize * 0.5) / planeSize;

                        advect.uniforms.mouse.value = new THREE.Vector2(x, y);
                        var force = new THREE.Vector2(x - x0, y - y0);
                        var mag = Math.max(Math.min(force.length(), 0.08), 0.0);
                        advect.uniforms.radius.value = mag * 0.5;

                        x0 = x;
                        y0 = y;

                    } else {
                        advect.uniforms.radius.value = 0.0;
                    }

                    advect.uniforms.velocity.value = fboVelocityPP.getReadBuffer();
                    blit(advect, fboVelocityPP.getWriteBuffer());
                    fboVelocityPP.swap();

                    renderer.render(scene, camera);

                    var delta = clock.getDelta();
                    trackballControls.update(delta);
                })();

            };

            this.loadShaders([
                "kernel.vert",
                "init.frag",
                "advect.frag",
            ], function(shaders) {
                start(shaders[0], shaders[1], shaders[2]);
            });

            var updateRendererSize = function() {
                var w = window.innerWidth;
                var h = window.innerHeight;
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
                renderer.setSize(w, h);
            };
            $(window).on('resize', updateRendererSize);
        },

        loadShaders : function(names, success) {
            var req = function(name) {
                var d = $.Deferred();
                app.loadShader(name, function(shader) {
                    d.resolve(shader);
                });
                return d;
            };

            $.when.apply($, names.map(function(name) { return req(name); })).done(function(s1, s2, s3) {
                if(success) success(arguments);
            });
        },

        loadShader: function(name, success) {
            return $.ajax({
                type: "GET",
                url: "assets/shaders/" + name,
                dataType: "text",
                success: function(shader) {
                    if(success) success(shader);
                },
                error: function() {
                }
            });
        },

        getRenderTarget: function(width, height, type) {
            return new THREE.WebGLRenderTarget(width, height, {
                wrapS: THREE.RepeatWrapping,
                wrapT: THREE.RepeatWrapping,
                minFilter: THREE.NearestFilter,
                magFilter: THREE.NearestFilter,
                format: THREE.RGBAFormat,
                type: type,
                stencilBuffer: false
            });
        }

    };

    global.App = App;

})(window, THREE);

$(function() {
    var app = new App("viewer");
});

