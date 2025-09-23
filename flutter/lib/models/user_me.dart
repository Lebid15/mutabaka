class UserMe {
  final int id;
  final String username;
  final String displayName;
  final String email;
  final String firstName;
  final String lastName;
  final String phone;
  final String countryCode;
  final String initials;
  final String? logoUrl;
  final int subscriptionRemainingDays;

  const UserMe({
    required this.id,
    required this.username,
    required this.displayName,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.phone,
    required this.countryCode,
    required this.initials,
    required this.logoUrl,
    required this.subscriptionRemainingDays,
  });

  factory UserMe.fromJson(Map<String, dynamic> json) => UserMe(
        id: (json['id'] ?? 0) as int,
        username: (json['username'] ?? '').toString(),
        displayName: (json['display_name'] ?? '').toString(),
        email: (json['email'] ?? '').toString(),
        firstName: (json['first_name'] ?? '').toString(),
        lastName: (json['last_name'] ?? '').toString(),
        phone: (json['phone'] ?? '').toString(),
        countryCode: (json['country_code'] ?? '').toString(),
        initials: (json['initials'] ?? '').toString(),
    logoUrl: json['logo_url']?.toString(),
        subscriptionRemainingDays:
            int.tryParse('${json['subscription_remaining_days'] ?? 0}') ?? 0,
      );
}
