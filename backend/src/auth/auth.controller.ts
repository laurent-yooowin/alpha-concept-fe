import { Controller, Post, Body } from '@nestjs/common';
import { AuthService, LoginDto, ForgotPasswordDto, VerifyCodeDto, ResetPasswordDto } from './auth.service';
import { RegisterDto } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  // Public registration is disabled in multi-tenant mode.
  // Users are created either by an ADMIN (own org) or by the HYPER_ADMIN.
  // @Post('register')
  // async register(@Body() registerDto: RegisterDto) {
  //   return this.authService.register(registerDto);
  // }

  @Post('forgot-password')
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('verify-code')
  async verifyCode(@Body() verifyCodeDto: VerifyCodeDto) {
    return this.authService.verifyCode(verifyCodeDto);
  }

  @Post('reset-password')
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }
}
