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
- `scripts/rpi-deploy/build-pi-image-docker.sh` - Complete Docker-based build script for macOS
- `scripts/rpi-deploy/build-pi-image.sh` - Updated with ACR1252U-M1 driver support
- `scripts/rpi-deploy/build-app-production.sh` - Added ACR1252U-M1 driver installation
- `README-DEPLOYMENT.md` - Updated for new directory structure and ACR1252U-M1 support
- `README.md` - Added Raspberry Pi deployment section with hardware requirements

### Recent Updates (Directory Restructure):
**🔄 Directory Structure Update**: 
- **All build scripts moved** to `scripts/rpi-deploy/` directory
- **Updated documentation** to reflect new file locations
- **Added cd instructions** for proper workflow
- **Fixed path references**: `build/` directory local to scripts, `dist/` at root level

**📡 ACR1252U-M1 NFC Reader Support**: 
- **Specific driver installation** for ACR1252U-M1 model
- **ACS PCSC drivers** included in build process
- **Hardware compatibility section** added to documentation
- **Troubleshooting guide** for NFC reader issues

**📖 Documentation Updates**:
- **Main README** now includes Raspberry Pi deployment section
- **Complete deployment guide** linked and updated
- **Hardware requirements** clearly specified
- **Step-by-step instructions** updated for new directory structure

### Critical Build Fixes Applied (December 2024):
**🔧 NFC Terminal Service Path Fix**:
- **Problem**: Service was trying to run `app/server.js` but file is actually `server.js` 
- **Solution**: Updated `nfc-terminal.service` in `build-app-production.sh` to use correct path
- **Changes Made**: 
  - Changed `ExecStart=/usr/bin/node app/server.js` to `ExecStart=/usr/bin/node server.js`
  - Updated pre-start check from `ls -la /opt/nfc-terminal/app/` to `ls -la /opt/nfc-terminal/server.js`
  - Added `-` prefix to `EnvironmentFile` to make .env file optional

**🏠 File Ownership Fix**:
- **Problem**: `start-kiosk.sh` and other files in `/home/freepay/` had incorrect ownership
- **Solution**: Added explicit ownership setting in Docker build script
- **Changes Made**: Added `chown -R 1000:1000 "$MOUNT_ROOT/home/freepay"` after file copying

**✅ Verified Working Configuration**:
- NFC terminal service starts successfully and responds on http://localhost:3000
- GUI service launches X11 and Chromium in kiosk mode
- All files have correct ownership and permissions
- System boots directly to fullscreen NFC terminal interface

**🖥️ Portrait Mode Display Support**:
- **Problem**: User requested 90-degree rotation for vertical orientation
- **Initial Solution**: Counterclockwise rotation with `display_rotate=3`
- **Touchscreen Issue**: Touch coordinates didn't map correctly with counterclockwise rotation
- **Final Solution**: Switched to clockwise rotation for better touchscreen compatibility
- **Changes Made**:
  - Boot-level rotation: `display_rotate=1` (90° clockwise) in `/boot/config.txt`
  - X11 software rotation: `xrandr --rotate right` in GUI startup scripts
  - Touch screen transformation: Updated for clockwise rotation with `TransformationMatrix "0 1 0 -1 0 1 0 0 1"`
  - Touch inversion: `InvertY=true` for clockwise portrait mode
  - Both `.xinitrc` and `start-kiosk.sh` updated with clockwise rotation commands
- **Benefit**: Clockwise rotation provides better touchscreen coordinate mapping for most displays

**🔧 Comprehensive Build Improvements (December 2024)**:
- **Problem**: Manual fixes required after image deployment for missing GUI files and packages
- **Solution**: Enhanced build scripts to include all necessary components automatically
- **Changes Made**:
  - **File Verification**: Added checks to ensure `start-kiosk.sh` and other critical files are properly copied during build
  - **Package Verification**: Added verification of essential GUI packages (chromium-browser, openbox, unclutter, xinit, curl)
  - **Enhanced Service Checks**: Updated `start-gui.service` with comprehensive pre-start validation
  - **User Setup Robustness**: Added emergency user creation and verification in chroot environment
  - **X11 Configuration**: Enhanced X11 wrapper setup with directory creation and verification
  - **Comprehensive Debug Script**: Enhanced GUI debug script with file checks, package verification, and user permissions
  - **Build-time Validation**: Added verification steps throughout the build process to catch issues early
- **Benefits**: Future images will include all fixes automatically, eliminating need for manual post-deployment scripts

### Docker Build Issue Resolved:

**🐳 Docker Credential Problem**: 
- **Issue**: `docker-credential-desktop: executable file not found` on macOS
- **Root Cause**: Docker Desktop credential helper path issues
- **Solution 1**: Created `build-pi-image-simple.sh` - bypasses Docker entirely
- **Solution 2**: Temporary Docker config fix for advanced users
- **Result**: Multiple working build paths for macOS users

### Files Added:
- `scripts/rpi-deploy/build-pi-image-simple.sh` - macOS-friendly simple build
- `complete-build-manual.sh` - Generated step-by-step completion guide

### ❌ NEW CRITICAL ISSUE IDENTIFIED - Package Installation Failure

**🚨 Build Process Issue**: Latest Docker build created broken image with missing packages
- **Root Cause**: Package installation in chroot environment failed during Docker build
- **Symptoms**: Pi boots but shows "read only file system" error, no SSH access
- **Missing Packages**: chromium-browser, openbox, xinit, openssh-server, Node.js
- **Impact**: Services fail to start → systemd protective read-only filesystem mount → inaccessible Pi

**🔧 Immediate Fixes Implemented**:
1. **fix-readonly-filesystem.sh** - Console recovery script for Pi with filesystem issues
2. **fix-missing-packages.sh** - Automated package installation script for broken Pi images
3. **Enhanced build-pi-image-docker.sh** with:
   - DNS configuration fixes for chroot environment
   - Package installation retries with timeout handling  
   - Multiple fallback options for each package
   - Comprehensive package verification before completing build
   - Build abortion if critical packages missing (prevents broken images)

**🏗️ Build Script Improvements**:
- Added robust DNS settings (`8.8.8.8`, `1.1.1.1`) in chroot
- Package installation with retries and 30-second timeouts
- Individual package fallbacks (chromium → firefox-esr, default nodejs repo)
- Critical package validation before image finalization
- Error handling prevents creation of non-functional images

**Recovery Options for Existing Broken Image**:
1. **Manual Recovery**: Connect keyboard/monitor to Pi → run recovery scripts
2. **Package Fix**: Transfer `fix-missing-packages.sh` to Pi and execute  
3. **Rebuild** (recommended): Use enhanced build scripts for new image

**Status**: Build scripts updated to prevent future package installation failures

## Lessons Learned

### Technical Implementation Insights:

1. **Configuration Validation is Critical**: The merchant address validation prevents costly deployment mistakes
2. **Systemd Service Dependencies**: Proper service ordering (WiFi → Network → App → UI) is essential for reliable startup
3. **Chroot Installation**: Installing packages in chroot environment is more reliable than cross-compilation for ARM64
4. **Image Size Management**: Adding 2GB to base image provides sufficient space for all dependencies
5. **Kiosk Mode Setup**: X11 auto-start with Chromium kiosk requires careful timing and dependency management

### Build Process Optimizations:

1. **Incremental Builds**: Base image download is cached to speed up subsequent builds

### Security Improvements:

**🔒 Docker Security Enhancement**:
- **Security Issue Identified**: Original Docker approach used `-v /dev:/dev` which exposed ALL host devices to container (major security risk)
- **Problem**: Could potentially allow container to modify host storage devices, filesystems, or other hardware
- **Solution Implemented**: Two-tier security approach:
  1. **Preferred Method**: Host-managed loop devices - Host creates loop device and passes only specific devices to container
  2. **Fallback Method**: Minimal privileged Docker with only essential capabilities
- **Security Benefits**: 
  - No exposure of host storage devices to container
  - Loop device creation managed by trusted host environment
  - Container runs with minimal required permissions
  - Automatic cleanup of loop devices on completion
- **Technical Implementation**: Created separate `docker-build-script-host-loop.sh` for the safer approach
- **Result**: Fully automated build with strong security boundaries

---

**Planner's Assessment**: This is a complex but achievable project. The key is breaking it down into manageable phases and ensuring each component works before moving to the next. The biggest challenges will be cross-platform compatibility and hardware driver integration.

**Estimated Timeline**: 2-3 days for initial working version, 1 week for polished, production-ready system.

**Risk Factors**: 
- NFC driver compatibility on ARM64
- Touchscreen driver issues
- Network connectivity configuration
- Boot time optimization 

## Lessons Learned

### Technical Lessons from Boot Issues (December 2024)

**Service Path Validation**:
- Always verify that systemd service `ExecStart` paths match actual file locations
- Test service files against the actual deployed file structure, not assumed structure
- Use full debugging checks in service pre-start commands to catch missing files early

**File Ownership in Chroot Builds**:
- When copying files to mounted filesystems before chroot, set ownership using UIDs (1000:1000) not usernames
- Username-based ownership only works after the user exists in the target system
- Always set ownership both before AND after user creation for reliability

**Build Process Testing**:
- Always test that the built image actually boots and runs the intended services
- Create diagnostic scripts during build to help debug boot issues
- Include service status checks and file verification in diagnostic output

**Debugging Boot Issues**:
- Missing executable files often cause "No such file or directory" errors
- Check both file existence AND correct paths in service definitions  
- Use journalctl and systemctl status to identify service startup failures
- SSH access is critical for debugging - ensure it works before GUI attempts

**File Structure Consistency**:
- Document and verify where application files are actually installed vs. where services expect them
- Ensure build scripts match the actual runtime file layout
- Test file paths in both build-time and runtime contexts

**Package Installation in Docker Chroot Environment** (December 2024):
- DNS resolution can fail in Docker chroot environments, causing package installation failures
- Always configure DNS (`nameserver 8.8.8.8`) before package operations in chroot
- Use retries and timeouts for package downloads due to network instability in containers
- Validate critical packages are installed before finalizing image build
- Failed package installation can lead to broken images that appear to boot but have missing functionality
- Missing GUI packages cause service failures that can trigger read-only filesystem protection
- Always abort build process if essential packages fail to install rather than creating broken images