package com.taskr.core;

import com.taskr.core.Resources.User;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;


public class UserTest {
    @Test
    public void userHasAvailableTimeCounter() {
        User underTest = new User("Mom");
        assertThat(underTest.getAvailableTime()).isInstanceOf(Integer.class);

    }
    @Test
    public void userCanSetAvailableTimeCounter() {
        User underTest = new User("Paw");
        underTest.setAvailableTime(10);
        assertThat(underTest.getAvailableTime()).isEqualTo(10);
    }

}
