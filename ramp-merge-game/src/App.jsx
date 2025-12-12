import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Clock, Car, Trophy } from 'lucide-react';

const RampMergeGame = () => {
  const canvasRef = useRef(null);
  const [gameState, setGameState] = useState('ready');
  const [time, setTime] = useState(0);
  const [trafficLights, setTrafficLights] = useState({
    rampEntry: 'GREEN',
    rampMiddle: 'GREEN',
    mainMerge: 'GREEN'
  });
  const [vehiclesRemaining, setVehiclesRemaining] = useState(0);
  const [totalVehicles, setTotalVehicles] = useState(80);
  const [bestTime, setBestTime] = useState(null);
  const [message, setMessage] = useState('Click START to begin!');
  const [congestionLevel, setCongestionLevel] = useState(0);
  
  const gameRef = useRef({
    vehicles: [],
    nextId: 1,
    mainRoadLength: 1400,
    rampLength: 500,
    mergePoint: 500,
    exitPoint: 1300,
    dt: 0.03
  });

  // Vehicle class with friction physics
  class Vehicle {
    constructor(id, type, road, lane, pos) {
      this.id = id;
      this.type = type;
      this.road = road;
      this.lane = lane;
      this.pos = pos;
      this.v = 0;
      this.a = 0;
      this.len = type === 'truck' ? 15 : 7;
      this.maxV = type === 'truck' ? 20 : 26;
      this.maxA = type === 'truck' ? 1.2 : 2.0;
      this.comfortB = 2.5;
      this.s0 = 2.0;
      this.T = 1.2;
      this.merging = false;
      this.exited = false;
      this.stoppedTime = 0;
      
      // Friction coefficients
      this.staticFriction = 0.8;
      this.rollingFriction = 0.15;
      this.mass = type === 'truck' ? 2.0 : 1.0;
    }

    calcAcceleration(leader, trafficLight = null) {
      if (trafficLight && trafficLight.isRed) {
        const distToLight = trafficLight.pos - this.pos;
        if (distToLight > 0 && distToLight < 80) {
          if (distToLight < 5) {
            return -this.comfortB * 3;
          }
          return -this.comfortB * 1.5;
        }
      }

      const deltaV = leader ? this.v - leader.v : 0;
      const s = leader ? leader.pos - this.pos - leader.len : 1000;
      
      let frictionCoeff = this.rollingFriction;
      if (this.v < 0.5) {
        frictionCoeff = this.staticFriction;
        this.stoppedTime++;
      } else {
        this.stoppedTime = 0;
      }

      const sStar = this.s0 + Math.max(0, this.v * this.T + 
        (this.v * deltaV) / (2 * Math.sqrt(this.maxA * this.comfortB)));
      
      const aFree = this.maxA * (1 - Math.pow(this.v / this.maxV, 4)) - frictionCoeff;
      const aInt = leader ? -this.maxA * Math.pow(sStar / Math.max(s, 0.1), 2) : 0;
      
      return aFree + aInt;
    }

    update(dt, leader, trafficLight) {
      this.a = this.calcAcceleration(leader, trafficLight);
      
      if (this.a < 0) {
        this.a -= this.rollingFriction * 0.5;
      }
      
      this.v = Math.max(0, this.v + this.a * dt);
      const effectiveMaxV = this.maxV - this.rollingFriction * 2;
      this.v = Math.min(this.v, effectiveMaxV);
      
      this.pos += this.v * dt;
    }
  }

  // Initialize vehicles
  const initVehicles = () => {
    const vehicles = [];
    const game = gameRef.current;
    let id = 1;

    console.log('Initializing vehicles...');

    // Main road vehicles - OVERCROWDED
    const mainCount = Math.floor(totalVehicles * 0.65);
    const mainSpacing = 30; // Very tight spacing
    
    for (let i = 0; i < mainCount; i++) {
      const type = Math.random() < 0.65 ? 'car' : 'truck';
      const lane = i % 2;
      const pos = i * mainSpacing;
      const veh = new Vehicle(id++, type, 'main', lane, pos);
      veh.v = veh.maxV * (0.4 + Math.random() * 0.2);
      vehicles.push(veh);
    }

    // Ramp vehicles - OVERCROWDED
    const rampCount = totalVehicles - mainCount;
    const rampSpacing = 25;
    
    for (let i = 0; i < rampCount; i++) {
      const type = Math.random() < 0.75 ? 'car' : 'truck';
      const veh = new Vehicle(id++, type, 'ramp', 0, i * rampSpacing);
      veh.v = 0;
      vehicles.push(veh);
    }

    console.log(`Created ${vehicles.length} vehicles: ${mainCount} on main road, ${rampCount} on ramp`);
    
    gameRef.current.vehicles = vehicles;
    gameRef.current.nextId = id;
    setVehiclesRemaining(vehicles.length);
    
    return vehicles;
  };

  // Get traffic light at position
  const getTrafficLight = (veh, game) => {
    if (veh.road === 'ramp') {
      if (veh.pos < 150) {
        return {
          pos: 140,
          isRed: trafficLights.rampEntry === 'RED'
        };
      }
      if (veh.pos < 300) {
        return {
          pos: 290,
          isRed: trafficLights.rampMiddle === 'RED'
        };
      }
    } else if (veh.road === 'main' && veh.pos < game.mergePoint + 100) {
      return {
        pos: game.mergePoint - 50,
        isRed: trafficLights.mainMerge === 'RED'
      };
    }
    return null;
  };

  // Find leader vehicle
  const findLeader = (veh, vehicles) => {
    let leader = null;
    let minDist = Infinity;

    for (const other of vehicles) {
      if (other.id === veh.id || other.exited) continue;
      
      if (veh.road === 'main' && other.road === 'main' && 
          other.lane === veh.lane && other.pos > veh.pos) {
        const dist = other.pos - veh.pos;
        if (dist < minDist) {
          minDist = dist;
          leader = other;
        }
      } else if (veh.road === 'ramp' && other.road === 'ramp' && 
                 other.pos > veh.pos) {
        const dist = other.pos - veh.pos;
        if (dist < minDist) {
          minDist = dist;
          leader = other;
        }
      }
    }

    return leader;
  };

  // Try to merge ramp vehicle
  const tryMerge = (veh, vehicles, game) => {
    if (veh.road !== 'ramp' || veh.pos < game.mergePoint - 80) return false;
    
    if (trafficLights.rampEntry === 'RED' && veh.pos < 150) return false;
    if (trafficLights.rampMiddle === 'RED' && veh.pos < 300) return false;

    const targetLane = 1;
    let leader = null;
    let follower = null;
    let minLeaderDist = Infinity;
    let minFollowerDist = Infinity;

    for (const other of vehicles) {
      if (other.exited || other.road !== 'main' || other.lane !== targetLane) continue;
      
      const otherMergePos = other.pos;
      const vehMergePos = veh.pos;

      if (otherMergePos > vehMergePos) {
        const dist = otherMergePos - vehMergePos;
        if (dist < minLeaderDist) {
          minLeaderDist = dist;
          leader = other;
        }
      } else {
        const dist = vehMergePos - otherMergePos;
        if (dist < minFollowerDist) {
          minFollowerDist = dist;
          follower = other;
        }
      }
    }

    const gapFront = leader ? minLeaderDist - leader.len : 1000;
    const gapBack = follower ? minFollowerDist - veh.len : 1000;
    const minGap = veh.stoppedTime > 20 ? 35 : 25;

    if (gapFront > minGap && gapBack > minGap) {
      veh.road = 'main';
      veh.lane = targetLane;
      veh.merging = true;
      return true;
    }

    return false;
  };

  // Calculate congestion level
  const calculateCongestion = (vehicles) => {
    let stoppedCount = 0;
    let slowCount = 0;
    
    for (const veh of vehicles) {
      if (veh.exited) continue;
      if (veh.v < 0.5) stoppedCount++;
      else if (veh.v < veh.maxV * 0.3) slowCount++;
    }
    
    const total = vehicles.filter(v => !v.exited).length;
    return total > 0 ? ((stoppedCount * 2 + slowCount) / total) * 100 : 0;
  };

  // Game loop
  const updateGame = () => {
    if (gameState !== 'running') return;

    const game = gameRef.current;
    const { vehicles, dt, exitPoint } = game;

    for (const veh of vehicles) {
      if (veh.exited) continue;

      if (veh.road === 'ramp') {
        tryMerge(veh, vehicles, game);
      }

      const trafficLight = getTrafficLight(veh, game);
      const leader = findLeader(veh, vehicles);
      veh.update(dt, leader, trafficLight);

      if (veh.road === 'main' && veh.pos >= exitPoint) {
        veh.exited = true;
      }
    }

    setCongestionLevel(calculateCongestion(vehicles));

    const remaining = vehicles.filter(v => !v.exited).length;
    setVehiclesRemaining(remaining);

    if (remaining === 0) {
      setGameState('complete');
      const finalTime = time;
      if (!bestTime || finalTime < bestTime) {
        setBestTime(finalTime);
        setMessage(`🎉 NEW BEST TIME: ${finalTime.toFixed(1)}s!`);
      } else {
        setMessage(`Complete! Time: ${finalTime.toFixed(1)}s (Best: ${bestTime.toFixed(1)}s)`);
      }
    }
  };

  // Draw function
  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const game = gameRef.current;
    
    ctx.fillStyle = '#0a0a15';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = canvas.width / 1600;
    ctx.save();
    ctx.scale(scale, scale);

    // Draw main road
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(50, 180, 1500, 140);
    
    // Lane dividers
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.setLineDash([15, 10]);
    ctx.beginPath();
    ctx.moveTo(50, 250);
    ctx.lineTo(1550, 250);
    ctx.stroke();
    ctx.setLineDash([]);

    // Road edges
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(50, 180);
    ctx.lineTo(1550, 180);
    ctx.moveTo(50, 320);
    ctx.lineTo(1550, 320);
    ctx.stroke();

    // Draw ramp
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.moveTo(50, 450);
    ctx.lineTo(550, 450);
    ctx.quadraticCurveTo(600, 450, 620, 400);
    ctx.lineTo(650, 320);
    ctx.lineTo(50, 320);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(550, 450);
    ctx.quadraticCurveTo(600, 450, 620, 400);
    ctx.lineTo(650, 320);
    ctx.stroke();

    // Draw traffic lights
    const lights = [
      { x: 180, y: 430, state: trafficLights.rampEntry, label: 'Entry' },
      { x: 330, y: 410, state: trafficLights.rampMiddle, label: 'Middle' },
      { x: 480, y: 300, state: trafficLights.mainMerge, label: 'Merge' }
    ];

    for (const light of lights) {
      ctx.fillStyle = '#333';
      ctx.fillRect(light.x - 3, light.y - 60, 6, 60);
      
      ctx.fillStyle = '#222';
      ctx.fillRect(light.x - 18, light.y - 70, 36, 50);
      
      ctx.fillStyle = light.state === 'RED' ? '#ff0000' : '#440000';
      ctx.beginPath();
      ctx.arc(light.x, light.y - 55, 8, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = light.state === 'GREEN' ? '#00ff00' : '#004400';
      ctx.beginPath();
      ctx.arc(light.x, light.y - 35, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(light.label, light.x, light.y + 5);
    }

    // Draw vehicles
    const vehicles = game.vehicles;
    
    for (let i = 0; i < vehicles.length; i++) {
      const veh = vehicles[i];
      if (veh.exited) continue;

      let x, y;
      if (veh.road === 'main') {
        x = 50 + veh.pos;
        y = veh.lane === 0 ? 215 : 285;
      } else {
        x = 50 + veh.pos;
        const progress = Math.min(1, veh.pos / game.mergePoint);
        y = 385 - (progress * 65);
      }

      const speedRatio = veh.v / veh.maxV;
      let color;
      if (speedRatio < 0.05) color = '#ff0000';
      else if (speedRatio < 0.3) color = '#ff6600';
      else if (speedRatio < 0.6) color = '#ffaa00';
      else color = '#00cc66';

      if (veh.type === 'truck') {
        ctx.fillStyle = color;
        ctx.fillRect(x, y - 10, veh.len * 2.5, 20);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(x, y - 8, veh.len * 2, 16);
      }
      
      ctx.fillStyle = veh.v > 0.1 ? '#ffffff' : '#666666';
      const headlightSize = veh.type === 'truck' ? veh.len * 2.5 : veh.len * 2;
      ctx.fillRect(x + headlightSize - 2, y - 6, 2, 3);
      ctx.fillRect(x + headlightSize - 2, y + 3, 2, 3);
    }

    ctx.restore();
  };

  // Animation loop
  useEffect(() => {
    let animationId;
    let lastTime = performance.now();

    const animate = (currentTime) => {
      const deltaTime = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      if (gameState === 'running') {
        setTime(t => t + deltaTime);
        updateGame();
      }

      draw();
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [gameState, trafficLights, time]);

  const startGame = () => {
    const vehicles = initVehicles();
    console.log('Game started with vehicles:', vehicles.length);
    setTime(0);
    setGameState('running');
    setMessage('Control all 3 traffic lights! Manage the overcrowded traffic!');
  };

  const togglePause = () => {
    setGameState(gameState === 'running' ? 'paused' : 'running');
  };

  const resetGame = () => {
    setGameState('ready');
    setTime(0);
    setTrafficLights({
      rampEntry: 'GREEN',
      rampMiddle: 'GREEN',
      mainMerge: 'GREEN'
    });
    setMessage('Click START to begin!');
    gameRef.current.vehicles = [];
    setVehiclesRemaining(0);
  };

  const toggleLight = (lightName) => {
    if (gameState !== 'running') return;
    setTrafficLights(prev => ({
      ...prev,
      [lightName]: prev[lightName] === 'RED' ? 'GREEN' : 'RED'
    }));
  };

  return (
    <div className="w-full min-h-screen bg-gradient-to-b from-gray-900 to-black flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-7xl bg-gray-800 rounded-lg shadow-2xl overflow-hidden">
        {/* <div className="bg-gradient-to-r from-red-600 via-orange-600 to-yellow-600 p-6 text-white">
          <h1 className="text-4xl font-bold mb-2">🚦 Ramp Merge Challenge - EXTREME MODE</h1>
          <p className="text-yellow-100">Master 3 traffic lights to control OVERCROWDED traffic with realistic friction!</p>
        </div> */}

        <div className="relative bg-gray-900">
          {/* --- Game Description --- */}
          <div className="mb-4 p-4 bg-gray-100 rounded-xl shadow">
            <h2 className="text-xl font-bold mb-2">Ramp Merge Challenge</h2>
            <p className="text-sm mb-2">
              Overcrowded highway. Realistic physics. Three traffic lights. One goal: clear every
              vehicle as fast as possible.
            </p>
            <ul className="list-disc ml-6 text-sm mb-2">
              <li><strong>Entry Light</strong> – releases vehicles into the ramp</li>
              <li><strong>Middle Light</strong> – regulates ramp flow</li>
              <li><strong>Merge Light</strong> – controls the final merge point</li>
            </ul>
            <p className="text-sm mb-2">
              Vehicles follow realistic friction physics—stopped cars accelerate slowly, moving cars
              maintain speed, and mis-timed signals cause massive jams.
            </p>
            <p className="text-sm font-semibold">
              Clear all vehicles and beat your best time. Can you coordinate all three signals?
            </p>
          </div>


          <canvas
            ref={canvasRef}
            width={1600}
            height={600}
            className="w-full"
          />
          
          {(gameState === 'ready' || gameState === 'complete') && (
            <div className="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center">
              <div className="bg-gray-800 p-8 rounded-lg text-center max-w-md">
                <p className="text-white text-2xl mb-4">{message}</p>
                {gameState === 'complete' && bestTime && (
                  <div className="bg-yellow-900 bg-opacity-50 p-4 rounded mb-4">
                    <Trophy className="inline-block text-yellow-400 mb-2" size={32} />
                    <p className="text-yellow-400 text-xl font-bold">Best: {bestTime.toFixed(1)}s</p>
                  </div>
                )}
                <button
                  onClick={gameState === 'ready' ? startGame : resetGame}
                  className="px-8 py-4 bg-green-500 hover:bg-green-600 text-white rounded-lg font-bold text-xl transition-colors"
                >
                  {gameState === 'ready' ? 'START GAME' : 'PLAY AGAIN'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="bg-gray-800 p-6 border-t border-gray-700">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="space-y-3">
              <div className="bg-gradient-to-r from-blue-900 to-blue-800 p-4 rounded-lg">
                <Clock className="text-blue-300 mb-2" size={24} />
                <div className="text-blue-200 text-sm">Time Elapsed</div>
                <div className="text-white text-3xl font-bold">{time.toFixed(1)}s</div>
              </div>
              
              <div className="bg-gradient-to-r from-green-900 to-green-800 p-4 rounded-lg">
                <Car className="text-green-300 mb-2" size={24} />
                <div className="text-green-200 text-sm">Vehicles Left</div>
                <div className="text-white text-3xl font-bold">{vehiclesRemaining}</div>
              </div>

              <div className="bg-gradient-to-r from-red-900 to-orange-900 p-4 rounded-lg">
                <div className="text-red-200 text-sm mb-1">Congestion</div>
                <div className="w-full bg-gray-700 rounded-full h-4 mb-2">
                  <div 
                    className="bg-gradient-to-r from-yellow-500 to-red-600 h-4 rounded-full transition-all"
                    style={{ width: `${Math.min(100, congestionLevel)}%` }}
                  />
                </div>
                <div className="text-white text-xl font-bold">{congestionLevel.toFixed(0)}%</div>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-4">
              <div className="flex gap-3">
                <button
                  onClick={togglePause}
                  disabled={gameState === 'ready' || gameState === 'complete'}
                  className="px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  {gameState === 'running' ? <Pause size={20} /> : <Play size={20} />}
                  {gameState === 'running' ? 'Pause' : 'Resume'}
                </button>
                <button
                  onClick={resetGame}
                  className="px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <RotateCcw size={20} />
                  Reset
                </button>
              </div>

              <div className="bg-gray-700 p-4 rounded-lg">
                <label className="text-gray-300 text-sm mb-3 block font-bold">Total Vehicles (More = Harder!)</label>
                <input
                  type="range"
                  min="50"
                  max="120"
                  value={totalVehicles}
                  onChange={(e) => setTotalVehicles(parseInt(e.target.value))}
                  disabled={gameState !== 'ready'}
                  className="w-full"
                />
                <div className="text-white text-center mt-2 text-xl font-bold">{totalVehicles} vehicles</div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-700 p-4 rounded-lg">
                  <div className="text-gray-300 text-sm mb-3 font-bold text-center">🚦 RAMP ENTRY</div>
                  <button
                    onClick={() => toggleLight('rampEntry')}
                    disabled={gameState !== 'running'}
                    className={`w-full px-4 py-8 rounded-lg font-bold text-lg transition-all ${
                      trafficLights.rampEntry === 'RED'
                        ? 'bg-red-600 text-white shadow-lg shadow-red-500/50'
                        : 'bg-green-600 text-white shadow-lg shadow-green-500/50'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {trafficLights.rampEntry === 'RED' ? '🔴 STOP' : '🟢 GO'}
                  </button>
                  <div className="text-gray-400 text-xs mt-2 text-center">Controls ramp entrance</div>
                </div>

                <div className="bg-gray-700 p-4 rounded-lg">
                  <div className="text-gray-300 text-sm mb-3 font-bold text-center">🚦 RAMP MIDDLE</div>
                  <button
                    onClick={() => toggleLight('rampMiddle')}
                    disabled={gameState !== 'running'}
                    className={`w-full px-4 py-8 rounded-lg font-bold text-lg transition-all ${
                      trafficLights.rampMiddle === 'RED'
                        ? 'bg-red-600 text-white shadow-lg shadow-red-500/50'
                        : 'bg-green-600 text-white shadow-lg shadow-green-500/50'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {trafficLights.rampMiddle === 'RED' ? '🔴 STOP' : '🟢 GO'}
                  </button>
                  <div className="text-gray-400 text-xs mt-2 text-center">Controls ramp flow</div>
                </div>

                <div className="bg-gray-700 p-4 rounded-lg">
                  <div className="text-gray-300 text-sm mb-3 font-bold text-center">🚦 MAIN MERGE</div>
                  <button
                    onClick={() => toggleLight('mainMerge')}
                    disabled={gameState !== 'running'}
                    className={`w-full px-4 py-8 rounded-lg font-bold text-lg transition-all ${
                      trafficLights.mainMerge === 'RED'
                        ? 'bg-red-600 text-white shadow-lg shadow-red-500/50'
                        : 'bg-green-600 text-white shadow-lg shadow-green-500/50'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {trafficLights.mainMerge === 'RED' ? '🔴 STOP' : '🟢 GO'}
                  </button>
                  <div className="text-gray-400 text-xs mt-2 text-center">Controls highway merge</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-gray-700 to-gray-800 p-4 text-gray-200 text-sm border-t border-gray-600">
          <strong className="text-yellow-400">🎯 Challenge:</strong> You control 3 traffic lights! The traffic is OVERCROWDED. 
          <strong className="text-red-400"> RED vehicles = stopped</strong>, <strong className="text-orange-400">ORANGE = slow</strong>, 
          <strong className="text-green-400"> GREEN = fast</strong>. 
          Due to <strong>friction physics</strong>, vehicles accelerate slowly from stops (static friction) but maintain speed better when moving (rolling friction). 
          Balance all 3 lights to minimize total time!
        </div>
      </div>
    </div>
  );
};

export default RampMergeGame;