#!/bin/bash
set -e

echo "🔧 Setting up Raspberry Pi Image Build Environment on macOS..."

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ This script is designed for macOS. For Linux, use apt-get/yum equivalents."
    exit 1
fi

# Install Homebrew if not present
if ! command -v brew &> /dev/null; then
    echo "📦 Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Install required tools
echo "📦 Installing required packages..."
brew update

# Essential tools for image manipulation
brew install wget
brew install qemu
brew install dosfstools
brew install e2fsprogs

# Install Node.js if not present (for application building)
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    brew install node
fi

# Create build directories
echo "📁 Creating build directories..."
mkdir -p build/{images,mount,work,config}
mkdir -p build/logs

# Download required utilities
echo "📦 Downloading additional utilities..."
# Download fdisk utility that works with loop devices
if [ ! -f "build/fdisk-util.sh" ]; then
    cat > build/fdisk-util.sh << 'EOF'
#!/bin/bash
# Utility functions for disk operations
get_partition_info() {
    local image=$1
    fdisk -l "$image" | grep -E "^$image"
}

mount_image_partitions() {
    local image=$1
    local mount_base=$2
    
    # Get partition info
    local boot_offset=$(fdisk -l "$image" | grep "${image}1" | awk '{print $2}')
    local root_offset=$(fdisk -l "$image" | grep "${image}2" | awk '{print $2}')
    
    # Convert sectors to bytes (sector size = 512)
    boot_offset=$((boot_offset * 512))
    root_offset=$((root_offset * 512))
    
    # Create mount points
    mkdir -p "${mount_base}/boot" "${mount_base}/root"
    
    # Mount partitions
    sudo mount -o loop,offset=$boot_offset "$image" "${mount_base}/boot"
    sudo mount -o loop,offset=$root_offset "$image" "${mount_base}/root"
}

unmount_image_partitions() {
    local mount_base=$1
    sudo umount "${mount_base}/boot" 2>/dev/null || true
    sudo umount "${mount_base}/root" 2>/dev/null || true
}
EOF
    chmod +x build/fdisk-util.sh
fi

# Create configuration validation script
echo "📦 Creating configuration validation script..."
cat > build/validate-config.sh << 'EOF'
#!/bin/bash
set -e

validate_config() {
    local config_file=$1
    
    if [ ! -f "$config_file" ]; then
        echo "❌ Configuration file not found: $config_file"
        echo "Please create build-config.env with your settings."
        return 1
    fi
    
    source "$config_file"
    
    # Check required variables
    local errors=0
    
    if [ -z "$WIFI_SSID" ]; then
        echo "❌ WIFI_SSID is required"
        errors=$((errors + 1))
    fi
    
    if [ -z "$WIFI_PASSWORD" ]; then
        echo "❌ WIFI_PASSWORD is required"
        errors=$((errors + 1))
    fi
    
    if [ -z "$ALCHEMY_API_KEY" ]; then
        echo "❌ ALCHEMY_API_KEY is required"
        errors=$((errors + 1))
    fi
    
    if [ -z "$MERCHANT_ETH_ADDRESS" ]; then
        echo "❌ MERCHANT_ETH_ADDRESS is required"
        errors=$((errors + 1))
    fi
    
    # Validate merchant address format
    if [ "$MERCHANT_ETH_ADDRESS" = "0x000000000000000000000000000000000000000000000000" ]; then
        echo "❌ MERCHANT_ETH_ADDRESS is still set to default value!"
        echo "   Please set your actual merchant wallet address."
        echo "   Current: $MERCHANT_ETH_ADDRESS"
        errors=$((errors + 1))
    fi
    
    # Validate Ethereum address format (42 chars, starts with 0x)
    if [[ ! "$MERCHANT_ETH_ADDRESS" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
        echo "❌ MERCHANT_ETH_ADDRESS is not a valid Ethereum address format"
        echo "   Expected: 0x followed by 40 hexadecimal characters"
        echo "   Current: $MERCHANT_ETH_ADDRESS"
        errors=$((errors + 1))
    fi
    
    if [ $errors -gt 0 ]; then
        echo ""
        echo "❌ BUILD FAILED: Configuration validation errors detected"
        echo "Please fix the above issues in your build-config.env file"
        return 1
    fi
    
    echo "✅ Configuration validation passed"
    return 0
}

# Export function for use in other scripts
export -f validate_config
EOF
chmod +x build/validate-config.sh

# Test QEMU installation
echo "🧪 Testing QEMU installation..."
if qemu-system-aarch64 --version > /dev/null 2>&1; then
    echo "✅ QEMU ARM64 emulation ready"
else
    echo "⚠️  QEMU ARM64 may not be fully configured"
fi

# Create sample configuration file
echo "📝 Creating configuration template..."
cat > build-config.env.template << 'EOF'
# WiFi Configuration
WIFI_SSID="YourWiFiNetwork"
WIFI_PASSWORD="YourWiFiPassword"

# Blockchain Configuration
ALCHEMY_API_KEY="your_alchemy_api_key_here"
MERCHANT_ETH_ADDRESS="0x000000000000000000000000000000000000000000000000"

# Supported Networks
BLOCKCHAIN_NETWORKS="ethereum,base,arbitrum,optimism,polygon,starknet"

# Optional: Application Settings
NODE_ENV="production"
LOG_LEVEL="info"
PORT="3000"
EOF

echo ""
echo "✅ Build environment setup complete!"
echo ""
echo "Next steps:"
echo "1. Copy build-config.env.template to build-config.env"
echo "2. Edit build-config.env with your actual WiFi and API credentials"
echo "3. Run the image build script (coming next)"
echo ""
echo "Files created:"
echo "  - build/ directory with subdirectories"
echo "  - build/fdisk-util.sh (disk utilities)"
echo "  - build/validate-config.sh (configuration validation)"
echo "  - build-config.env.template (configuration template)" 