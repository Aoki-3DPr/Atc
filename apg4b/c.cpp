#include <bits/stdc++.h>
#define ll long long
using namespace std;

ll pow26(int i) {
	ll result = 1;
	while (i--) {
		result *= 26;
	}
	return result;
}

int solve() {
	string s; cin>>s;
	ll ans = 0;
	for (int i = 0; i < s.length(); i++) {
		ans += (s[s.length() - 1 - i] - 'A' + 1) * pow26(i);
	}
	cout << ans << endl;
	return 0;
}

int main() {
	solve();
	return 0;
}
