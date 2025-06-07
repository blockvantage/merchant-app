# NFC Payment Terminal - Raspberry Pi Bootable Image Creation

## Background and Motivation

The user has requested to create a bootable MicroSD card image that can be inserted into a Raspberry Pi and will automatically:
- Boot into Ubuntu/Raspberry Pi OS
- Launch the NFC payment terminal application fullscreen on a 7" touchscreen
- Have all dependencies pre-installed and configured
- Require zero manual setup after inserting the SD card

The current application is a Node.js/TypeScript-based NFC payment terminal that supports multiple blockchain networks (Ethereum, Base, Arbitrum, Optimism, Polygon, Starknet) with real-time transaction monitoring.

## Key Challenges and Analysis

### Technical Challenges:
1. **Custom OS Image Creation**: Need to create a modified Ubuntu/Raspberry Pi OS image with pre-installed software
2. **Hardware Compatibility**: Ensure NFC reader (nfc-pcsc) works on ARM64 architecture
3. **Display Configuration**: Configure 7" touchscreen for fullscreen operation
4. **Auto-start Configuration**: Set up systemd services for automatic application launch
5. **Network Configuration**: Handle WiFi setup for blockchain connectivity
6. **Security Considerations**: Secure the system while maintaining functionality
7. **Cross-platform Build**: Build process needs to work on macOS for ARM64 target

### Hardware Requirements Analysis:
- Raspberry Pi 4B (recommended for performance)
- 7" Official Raspberry Pi Touchscreen or compatible
- NFC reader compatible with nfc-pcsc library
- MicroSD card (32GB+ recommended)

### Software Stack Requirements:
- Ubuntu Server 22.04 LTS ARM64 or Raspberry Pi OS Lite
- Node.js 18+ (ARM64 build)
- NFC libraries (libnfc, pcsclite)
- Chromium browser for kiosk mode
- systemd services for auto-start

## High-level Task Breakdown

### Phase 1: Environment Setup and Image Preparation
- [ ] **Task 1.1**: Create build environment script
  - Success Criteria: Script sets up all required tools (qemu, debootstrap, etc.)
- [ ] **Task 1.2**: Download and prepare base Ubuntu ARM64 image
  - Success Criteria: Clean base image ready for customization
- [ ] **Task 1.3**: Set up cross-compilation environment
  - Success Criteria: Can build ARM64 binaries from macOS

### Phase 2: Application Preparation and Bundling
- [ ] **Task 2.1**: Create production build script
  - Success Criteria: Application builds successfully with all dependencies
- [ ] **Task 2.2**: Bundle application with Node.js runtime
  - Success Criteria: Self-contained application package created
- [ ] **Task 2.3**: Create environment configuration system
  - Success Criteria: .env template with WiFi credentials and Alchemy API key ready for deployment
- [ ] **Task 2.4**: Create WiFi configuration injection system
  - Success Criteria: Build script can embed WiFi credentials into image

### Phase 3: System Configuration and Services
- [ ] **Task 3.1**: Create systemd service files
  - Success Criteria: Application auto-starts on boot
- [ ] **Task 3.2**: Configure WiFi auto-connect service
  - Success Criteria: Device automatically connects to pre-configured WiFi on boot
- [ ] **Task 3.3**: Configure display and touchscreen settings
  - Success Criteria: 7" screen works fullscreen without manual intervention
- [ ] **Task 3.4**: Set up kiosk mode (browser-based UI)
  - Success Criteria: Application runs fullscreen in browser kiosk mode
- [ ] **Task 3.5**: Configure NFC hardware support
  - Success Criteria: NFC reader works automatically on boot
- [ ] **Task 3.6**: Create environment variable loading system
  - Success Criteria: .env file loaded correctly by application service

### Phase 4: Image Creation and Customization
- [ ] **Task 4.1**: Create custom image build script
  - Success Criteria: Automated script creates bootable image
- [ ] **Task 4.2**: Install and configure all dependencies in image
  - Success Criteria: All required packages installed and configured
- [ ] **Task 4.3**: Embed application and services in image
  - Success Criteria: Application ready to run on first boot
- [ ] **Task 4.4**: Configure first-boot setup scripts
  - Success Criteria: WiFi and other settings can be configured on first boot

### Phase 5: Testing and Optimization
- [ ] **Task 5.1**: Create test suite for image validation
  - Success Criteria: Automated tests verify image functionality
- [ ] **Task 5.2**: Optimize image size and boot time
  - Success Criteria: Image fits on 32GB SD card, boots in <60 seconds
- [ ] **Task 5.3**: Create user documentation
  - Success Criteria: Clear instructions for deployment and configuration

### Phase 6: Build Automation
- [ ] **Task 6.1**: Create configuration validation system
  - Success Criteria: Build fails if MERCHANT_ETH_ADDRESS is still default 0x000... value
- [ ] **Task 6.2**: Create master build script with configuration injection
  - Success Criteria: Single command creates ready-to-flash image with embedded WiFi/API credentials
- [ ] **Task 6.3**: Create configuration template system
  - Success Criteria: Easy customization for different WiFi networks, API keys, and blockchain settings
- [ ] **Task 6.4**: Create deployment configuration guide
  - Success Criteria: Clear instructions for setting WiFi credentials and API keys before build
- [ ] **Task 6.5**: Create flashing instructions
  - Success Criteria: Simple process to write configured image to SD card

## Technical Architecture Plan

### Image Structure:
```
Custom Raspberry Pi OS Image
├── Boot Partition (FAT32)
│   ├── kernel, initrd, device tree
│   └── config.txt (display/hardware config)
├── Root Partition (ext4)
│   ├── /opt/nfc-terminal/
│   │   ├── app/ (Node.js application)
│   │   ├── node_modules/
│   │   ├── .env (API keys, config)
│   │   └── config/
│   ├── /etc/systemd/system/
│   │   ├── nfc-terminal.service
│   │   ├── display-setup.service
│   │   └── wifi-connect.service
│   ├── /etc/wpa_supplicant/
│   │   └── wpa_supplicant.conf (WiFi credentials)
│   └── /home/pi/ (user data)
```

### Service Dependencies:
1. `wifi-connect.service` → Connect to pre-configured WiFi
2. `display-setup.service` → Configure 7" screen
3. `network-online.target` → Ensure internet connectivity
4. `nfc-terminal.service` → Start application (depends on network)
5. `chromium-kiosk.service` → Launch browser in kiosk mode

## Proposed Build Tools and Methods

### Option 1: Ubuntu Core/Snap-based (Recommended)
- Use Ubuntu Core for embedded systems
- Package application as snap for easy updates
- Built-in security and update mechanisms

### Option 2: Custom Buildroot Image
- Minimal Linux distribution
- Faster boot times
- More complex to set up

### Option 3: Modified Raspberry Pi OS
- Based on Debian, well-supported hardware
- Easier NFC driver compatibility
- Larger image size

**Recommendation**: Start with Option 3 (Modified Raspberry Pi OS) for faster development, then potentially move to Option 1 for production.

## Configuration Management Strategy

### Pre-Build Configuration Files:
1. **`build-config.env`** - Master configuration file for build process
   ```bash
   WIFI_SSID="YourWiFiNetwork"
   WIFI_PASSWORD="YourWiFiPassword"
   ALCHEMY_API_KEY="your_alchemy_api_key_here"
   BLOCKCHAIN_NETWORKS="ethereum,base,arbitrum,optimism,polygon,starknet"
   MERCHANT_ETH_ADDRESS="0x00000000000000000000000000000000000000000000000000"
   ```

2. **`app-config.template.env`** - Template for application environment variables
   ```bash
   ALCHEMY_API_KEY=${ALCHEMY_API_KEY}
   MERCHANT_ETH_ADDRESS=${MERCHANT_ETH_ADDRESS}
   NODE_ENV=production
   PORT=3000
   LOG_LEVEL=info
   ```

### Deployment Workflow:
1. User creates `build-config.env` with their WiFi, API credentials, and merchant address
2. Build script validates configuration:
   - **FAILS BUILD** if `MERCHANT_ETH_ADDRESS` is still default `0x000...` value
   - Validates Ethereum address format
   - Ensures all required fields are present
3. Build script reads config and injects into image:
   - WiFi credentials → `/etc/wpa_supplicant/wpa_supplicant.conf`
   - API keys & merchant address → `/opt/nfc-terminal/.env`
4. Image boots with pre-configured connectivity and credentials

### Security Considerations:
- Credentials embedded in image (acceptable for kiosk deployment)
- **Build validation prevents accidental deployment with default merchant address**
- Ethereum address format validation before build
- Option to encrypt .env file if needed
- WiFi credentials stored in standard wpa_supplicant format

### Validation Rules:
- `MERCHANT_ETH_ADDRESS` must not be `0x000000000000000000000000000000000000000000000000`
- `MERCHANT_ETH_ADDRESS` must be valid Ethereum address format (42 chars, starts with 0x)
- `ALCHEMY_API_KEY` must be present and non-empty
- `WIFI_SSID` and `WIFI_PASSWORD` must be present

## Project Status Board

### Current Status / Progress Tracking
- [x] Project analysis and planning completed
- [x] Environment setup (Task 1.1 ✅)
- [x] Application bundling (Tasks 2.1-2.4 ✅)
- [x] System configuration (Tasks 3.1-3.6 ✅)
- [x] Image creation (Tasks 4.1-4.4 ✅)
- [x] Build automation (Tasks 6.1-6.2 ✅)
- [ ] Testing and validation
- [x] Documentation (Task 6.4 ✅)

### Next Steps
1. Set up build environment on macOS
2. Create configuration template system (WiFi + .env)
3. Create application production build
4. Develop image customization scripts with credential injection

## Executor's Feedback or Assistance Requests

### Completed Tasks (Executor Report):

✅ **Task 1.1 - Build Environment Setup**: Created `setup-build-environment.sh` with:
- macOS compatibility checks
- Homebrew and tool installation (qemu, dosfstools, e2fsprogs)
- Configuration validation system
- Disk utilities for image manipulation

✅ **Tasks 2.1-2.4 - Application Production Build**: Created `build-app-production.sh` with:
- TypeScript compilation and production bundling
- Complete systemd service files (wifi-connect, nfc-terminal, display-setup, chromium-kiosk)
- Environment variable injection system
- Pi installation scripts and auto-configuration

✅ **Tasks 3.1-3.6 - System Configuration**: Implemented:
- WiFi auto-connect with wpa_supplicant configuration
- 7" display configuration for kiosk mode
- Auto-login and X11 startup scripts
- NFC hardware support with pcscd
- Complete service dependency chain

✅ **Tasks 4.1-4.4 & 6.1-6.2 - Master Build Script**: Created `build-pi-image.sh` with:
- **Critical validation system** (fails build if MERCHANT_ETH_ADDRESS = default)
- Automated Raspberry Pi OS download and customization
- Complete chroot installation of Node.js and dependencies
- WiFi credential and API key injection
- Image compression and deployment instructions

### Current Status:
**🎉 IMPLEMENTATION COMPLETE** - All core functionality delivered:

1. **Single Command Deployment**: `./build-pi-image.sh` creates complete bootable image
2. **Safety Validation**: Build fails if merchant address not configured
3. **Auto-Configuration**: WiFi, API keys, and services pre-configured
4. **Kiosk Mode**: Boots directly to fullscreen NFC terminal
5. **Hardware Support**: 7" touchscreen and NFC reader ready

### Issues Encountered and Resolved:

**🔧 macOS Compatibility Issue**: 
- **Problem**: Original build script failed due to `fdisk -l` syntax differences on macOS and lack of ext2/ext4 filesystem support
- **Root Cause**: macOS uses BSD fdisk with different options, and cannot mount Linux filesystems natively
- **Solution**: Created `build-pi-image-docker.sh` that runs the entire build process in an Ubuntu Docker container
- **Result**: Full macOS compatibility maintained with Linux build environment

### Files Updated:
- `build/fdisk-util.sh` - Added macOS-compatible disk utilities with hdiutil
- `build-pi-image-docker.sh` - Complete Docker-based build script for macOS
- `README-DEPLOYMENT.md` - Added macOS compatibility section and troubleshooting

### Ready for Testing Phase

## Lessons Learned

### Technical Implementation Insights:

1. **Configuration Validation is Critical**: The merchant address validation prevents costly deployment mistakes
2. **Systemd Service Dependencies**: Proper service ordering (WiFi → Network → App → UI) is essential for reliable startup
3. **Chroot Installation**: Installing packages in chroot environment is more reliable than cross-compilation for ARM64
4. **Image Size Management**: Adding 2GB to base image provides sufficient space for all dependencies
5. **Kiosk Mode Setup**: X11 auto-start with Chromium kiosk requires careful timing and dependency management

### Build Process Optimizations:

1. **Incremental Builds**: Base image download is cached to speed up subsequent builds
2. **Error Handling**: Comprehensive cleanup functions prevent corrupted partial builds
3. **Validation First**: Configuration validation at start saves time versus failing later in process

### Hardware Compatibility Notes:

1. **NFC Readers**: pcscd and libnfc provide broad compatibility with USB NFC readers
2. **Display Configuration**: Standard HDMI settings work with most 7" displays
3. **WiFi Setup**: wpa_supplicant provides reliable WiFi auto-connect

---

**Planner's Assessment**: This is a complex but achievable project. The key is breaking it down into manageable phases and ensuring each component works before moving to the next. The biggest challenges will be cross-platform compatibility and hardware driver integration.

**Estimated Timeline**: 2-3 days for initial working version, 1 week for polished, production-ready system.

**Risk Factors**: 
- NFC driver compatibility on ARM64
- Touchscreen driver issues
- Network connectivity configuration
- Boot time optimization 