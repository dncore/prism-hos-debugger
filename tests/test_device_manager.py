"""Tests for device manager — hdc wrapper."""

import asyncio
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from prism.device_manager import DeviceManager
from prism.models import Device, DeviceStatus


class TestDeviceListParsing:
    """Test parsing of hdc list targets output."""

    def test_parse_empty_output(self):
        mgr = DeviceManager()
        devices = mgr._parse_device_list("")
        assert devices == []

    def test_parse_simple_output(self):
        mgr = DeviceManager()
        devices = mgr._parse_device_list("ABC1234567\nDEF7654321")
        assert len(devices) == 2
        assert devices[0].device_id == "ABC1234567"
        assert devices[1].device_id == "DEF7654321"

    def test_parse_with_transport(self):
        mgr = DeviceManager()
        devices = mgr._parse_device_list("192.168.1.100:8710\ttcp")
        assert len(devices) == 1
        assert devices[0].device_id == "192.168.1.100:8710"
        assert devices[0].transport == "tcp"

    def test_parse_verbose_output(self):
        """Parse -v output with extra columns."""
        mgr = DeviceManager()
        output = "ABC1234567\tdevice\tonline\nDEF7654321\tdevice\toffline"
        devices = mgr._parse_device_list(output)
        assert len(devices) == 2
        assert devices[0].status == DeviceStatus.ONLINE
        assert devices[1].status == DeviceStatus.OFFLINE


class TestDeviceManager:
    """Test device selection and management."""

    @pytest.mark.asyncio
    async def test_select_device_not_found(self):
        mgr = DeviceManager()

        # Mock list_devices to return empty
        with patch.object(mgr, 'list_devices', return_value=[]):
            result = await mgr.select_device("nonexistent")
            assert result is False
            assert mgr.selected_device_id is None

    @pytest.mark.asyncio
    async def test_select_device_success(self):
        mgr = DeviceManager()
        devices = [Device(device_id="ABC123", status=DeviceStatus.ONLINE)]

        with patch.object(mgr, 'list_devices', return_value=devices):
            result = await mgr.select_device("ABC123")
            assert result is True
            assert mgr.selected_device_id == "ABC123"


class TestPortForwarding:
    """Test port forwarding command construction."""

    def test_hdc_args_with_device(self):
        mgr = DeviceManager()  # auto-discovery might find a real hdc
        mgr.hdc_bin = "hdc"   # override after init for testing
        mgr.selected_device_id = "ABC123"
        args = mgr._hdc_args("shell", "ls")
        assert args[0] == "hdc"
        assert "-t" in args
        assert "ABC123" in args
        assert "shell" in args
        assert "ls" in args
